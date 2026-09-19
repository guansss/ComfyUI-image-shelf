from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

from aiohttp import typedefs, web

from .configuration import ShelfSettings
from .database import ImageRepository
from .indexer import FolderIndexer, IndexingResult
from .log import logger
from .metadata.metadata import get_image_metadata
from .models import GalleryFolder
from .paths import is_within_directory, normalize_path
from .search import SearchTerm
from .transfer import (
    BatchFileConflictError,
    FileConflictError,
    transfer_file,
    transfer_files,
)
from .watcher import FolderWatcher


class GalleryApi:
    def __init__(
        self,
        repository: ImageRepository,
        settings: ShelfSettings,
    ) -> None:
        self.repository = repository
        self.settings = settings
        self.folders: tuple[GalleryFolder, ...] = ()
        self.indexer = FolderIndexer(repository)
        self.indexing_tasks: dict[Path, asyncio.Task[IndexingResult]] = {}
        self.indexing_errors: dict[Path, BaseException] = {}
        self.folder_picker_tasks: set[asyncio.Task[None]] = set()
        self.websocket_clients: set[web.WebSocketResponse] = set()
        self.watcher: FolderWatcher | None = None

    async def apply_settings(self) -> None:
        await self._replace_and_reindex(self.settings.get_folders())

    async def _replace_and_reindex(self, folders: list[GalleryFolder]) -> None:
        previous_paths = self._tracked_paths()
        self.folders = self._normalize_folders(folders)
        current_paths = self._tracked_paths()
        for path in previous_paths - current_paths:
            task = self.indexing_tasks.pop(path, None)
            if task and not task.done():
                task.cancel()
            self.indexing_errors.pop(path, None)
        self.repository.delete_untracked_paths(current_paths)
        if self.watcher:
            self.watcher.reconfigure(current_paths)
        await self._broadcast(
            "foldersUpdated", {"folders": [folder.as_dict() for folder in self.folders]}
        )
        await self._index_folders(current_paths - previous_paths)

    async def _index_folders(self, folders: set[Path]) -> None:
        for folder in folders:
            task = self.indexing_tasks.get(folder)
            if task is None or task.done():
                self.indexing_tasks[folder] = self._create_indexing_task(folder)

    def _create_indexing_task(
        self, folder: Path, force: bool = False
    ) -> asyncio.Task[IndexingResult]:
        task = asyncio.create_task(self._index_folder_and_broadcast(folder, force))
        task.add_done_callback(lambda t: self._handle_indexing_task_done(folder, t))
        return task

    def _handle_indexing_task_done(
        self, folder: Path, task: asyncio.Task[IndexingResult]
    ) -> None:
        if task.cancelled():
            logger.info("Indexing task for %s was cancelled", folder)
        elif (error := task.exception()) is not None:
            logger.error("Indexing task for %s failed: %s", folder, error)
            self.indexing_errors[folder] = error
        else:
            self.indexing_errors.pop(folder, None)
            task.result()

    async def _index_folder_and_broadcast(
        self, folder: Path, force: bool = False
    ) -> IndexingResult:
        folder_ids = tuple(item.id for item in self.folders if folder == item.path)
        for folder_id in folder_ids:
            await self._broadcast("indexStart", {"folder": folder_id})

        try:
            result = await self.indexer.index_folder(folder, force=force)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            for folder_id in folder_ids:
                await self._broadcast(
                    "indexFinish", {"folder": folder_id, "error": str(error)}
                )
            raise

        for folder_id in folder_ids:
            await self._broadcast(
                "indexFinish", {"folder": folder_id, "result": asdict(result)}
            )
        return result

    async def start(self, loop: asyncio.AbstractEventLoop) -> None:
        logger.info("Starting Image Shelf API")
        if self.watcher is None:
            self.watcher = FolderWatcher(self._index_folder_and_broadcast, loop)
            self.watcher.start()
        self.settings.load()
        await self.apply_settings()

    async def shutdown_websockets(self) -> None:
        clients = tuple(self.websocket_clients)
        if clients:
            await asyncio.gather(
                *(client.close() for client in clients), return_exceptions=True
            )
        self.websocket_clients.clear()

    async def shutdown(self) -> None:
        if self.watcher:
            self.watcher.stop()
            self.watcher = None

        for task in self.folder_picker_tasks:
            task.cancel()
        if self.folder_picker_tasks:
            await asyncio.gather(*self.folder_picker_tasks, return_exceptions=True)
        active_tasks = [
            task for task in self.indexing_tasks.values() if not task.done()
        ]
        for task in active_tasks:
            task.cancel()
        if active_tasks:
            await asyncio.gather(*active_tasks, return_exceptions=True)

        self.repository.close()

    @staticmethod
    def _normalize_folders(folders: list[GalleryFolder]) -> tuple[GalleryFolder, ...]:
        return tuple(
            GalleryFolder(
                id=folder.id,
                name=folder.name,
                path=normalize_path(folder.path),
                editable=folder.editable,
                removable=folder.removable,
            )
            for folder in folders
        )

    def register(self, app: web.Application, register_startup: bool = True) -> None:
        app.add_routes(
            [
                web.get("/api/image-shelf/v1/folders", self.folders_status),
                web.get("/api/image-shelf/v1/images", self.list_images),
                web.get("/api/image-shelf/v1/images/{image_id}", self.image_details),
                web.post(
                    "/api/image-shelf/v1/images/{image_id}/transfer",
                    self.transfer_image,
                ),
                web.post(
                    "/api/image-shelf/v1/batch/images/transfer",
                    self.transfer_images,
                ),
                web.post(
                    "/api/image-shelf/v1/images/{image_id}/reveal",
                    self.reveal_image,
                ),
                web.post("/api/image-shelf/v1/pick-folder", self.pick_folder),
                web.get("/api/image-shelf/v1/websocket", self.websocket),
                web.get(
                    "/api/image-shelf/v1/images/{image_id}/file",
                    self.image_file,
                    name="image-shelf-image-file",
                ),
                web.get("/api/image-shelf/v1/tags", self.tags),
                web.get("/api/image-shelf/v1/settings", self.get_settings),
                web.post("/api/image-shelf/v1/settings", self.update_settings),
                web.post("/api/image-shelf/v1/reindex", self.reindex),
                web.get("/api/image-shelf/v1/status", self.folders_status),
            ]
        )
        if register_startup:
            app.on_startup.append(lambda app: self.start(asyncio.get_running_loop()))
        app.on_shutdown.append(lambda app: self.shutdown_websockets())
        app.on_cleanup.append(lambda app: self.shutdown())

    async def list_images(self, request: web.Request) -> web.Response:
        started_at = time.perf_counter()
        try:
            folder = self._folder_from_request(request)
            dimensions = tuple(
                _parse_dimension(value)
                for value in request.query.getall("dimension", [])
            )
            page = self.repository.list_images(
                self._paths_for_folder(folder),
                terms=self._terms_from_request(request),
                dimensions=dimensions,
                sort_by=request.query.get("sort", "created_at"),
                direction=request.query.get("direction", "desc"),
                page=int(request.query.get("page", "1")),
                page_size=int(request.query.get("page_size", "100")),
            )
        except (TypeError, ValueError) as error:
            raise web.HTTPBadRequest(text=str(error)) from error

        return web.json_response(
            {
                "items": [
                    {
                        **asdict(image),
                        "url": str(
                            request.app.router["image-shelf-image-file"].url_for(
                                image_id=image.id
                            )
                        ),
                    }
                    for image in page.items
                ],
                "page": page.page,
                "page_size": page.page_size,
                "total": page.total,
                "dimensions": [asdict(facet) for facet in page.dimensions],
                "elapsed": time.perf_counter() - started_at,
            }
        )

    async def image_file(self, request: web.Request) -> web.StreamResponse:
        path = self.repository.path_for_public_id(request.match_info["image_id"])
        if (
            path is None
            or not path.is_file()
            or not any(
                is_within_directory(path, folder) for folder in self._tracked_paths()
            )
        ):
            raise web.HTTPNotFound()
        return web.FileResponse(path)

    async def image_details(self, request: web.Request) -> web.Response:
        details, path = self.repository.image_details(
            request.match_info["image_id"]
        ) or (None, None)
        if (
            details is None
            or path is None
            or not any(
                is_within_directory(path, folder) for folder in self._tracked_paths()
            )
        ):
            raise web.HTTPNotFound()
        parse_error = details.parse_error
        metadata = None
        try:
            metadata = await asyncio.to_thread(_get_image_metadata, path)
        except Exception as error:
            parse_error = f"{parse_error} ||| {error}" if parse_error else str(error)
        return web.json_response(
            {
                **asdict(details),
                "metadata": asdict(metadata) if metadata is not None else None,
                "parse_error": parse_error,
            }
        )

    async def reveal_image(self, request: web.Request) -> web.Response:
        path = self.repository.path_for_public_id(request.match_info["image_id"])
        if (
            path is None
            or not path.is_file()
            or not any(
                is_within_directory(path, folder) for folder in self._tracked_paths()
            )
        ):
            raise web.HTTPNotFound()
        try:
            await asyncio.to_thread(_reveal_in_file_explorer, path)
        except OSError as error:
            raise web.HTTPInternalServerError(text=str(error)) from error
        return web.json_response({"accepted": True})

    async def pick_folder(self, request: web.Request) -> web.Response:
        task = asyncio.create_task(self._pick_folder_and_send())
        self.folder_picker_tasks.add(task)
        task.add_done_callback(self.folder_picker_tasks.discard)
        return web.json_response({"accepted": True}, status=202)

    async def websocket(self, request: web.Request) -> web.WebSocketResponse:
        websocket = web.WebSocketResponse(heartbeat=30)
        await websocket.prepare(request)
        self.websocket_clients.add(websocket)
        try:
            async for message in websocket:
                if message.type == web.WSMsgType.ERROR:
                    break
        finally:
            self.websocket_clients.discard(websocket)
        return websocket

    async def _pick_folder_and_send(self) -> None:
        try:
            picked_folder = await asyncio.to_thread(_pick_folder)
            result: dict[str, str | None] = {
                "path": str(normalize_path(picked_folder)) if picked_folder else None
            }
        except (ImportError, OSError, RuntimeError) as error:
            result = {"error": str(error)}

        await self._broadcast("pickFolder", result)

    async def _broadcast(self, event: str, data: dict[str, Any]) -> None:
        message = {"event": event, "data": data}
        clients = tuple(self.websocket_clients)
        results = await asyncio.gather(
            *(client.send_json(message) for client in clients),
            return_exceptions=True,
        )
        for client, result in zip(clients, results):
            if isinstance(result, Exception):
                self.websocket_clients.discard(client)
                logger.exception(
                    "Failed to send message to WebSocket client: %s", result
                )
                await client.close()

    async def transfer_image(self, request: web.Request) -> web.Response:
        source = self.repository.path_for_public_id(request.match_info["image_id"])
        if source is None or not any(
            is_within_directory(source, folder) for folder in self._tracked_paths()
        ):
            raise web.HTTPNotFound(text="Image not found or not within tracked folders")
        try:
            body = await request.json()
            if not isinstance(body, dict):
                raise TypeError("Transfer request must be an object.")
            folder_id = body.get("folder")
            if not isinstance(folder_id, str):
                raise TypeError("Transfer folder must be a string.")
            destination_folder = next(
                (folder.path for folder in self.folders if folder.id == folder_id),
                None,
            )
            if destination_folder is None:
                raise web.HTTPNotFound(text="Unknown Image Shelf folder")
            if not destination_folder.is_dir():
                raise web.HTTPNotFound(text="Target folder does not exist")
            if is_within_directory(source, destination_folder):
                raise web.HTTPBadRequest(text="Image is already in the target folder")
            mode = body.get("mode", "copy")
            conflict = body.get("conflict", "suggest")
            filename = body.get("filename")
            if not isinstance(mode, str):
                raise TypeError("Transfer mode must be a string.")
            if not isinstance(conflict, str):
                raise TypeError("Transfer conflict must be a string.")
            if filename is not None and not isinstance(filename, str):
                raise ValueError("Transfer filename must be a string.")
            destination = await asyncio.to_thread(
                transfer_file, source, destination_folder, mode, filename, conflict
            )
        except FileConflictError as error:
            return web.json_response(
                {
                    "error": "filename_conflict",
                    "suggested_filename": error.suggested_name,
                },
                status=409,
            )
        except (FileNotFoundError, TypeError, ValueError) as error:
            raise web.HTTPBadRequest(text=str(error)) from error
        return web.json_response(
            {"folder": folder_id, "filename": destination.name, "mode": mode},
            status=201,
        )

    async def transfer_images(self, request: web.Request) -> web.Response:
        sources: list[tuple[str, Path, str | None]] = []
        try:
            body = await request.json()
            if not isinstance(body, dict):
                raise TypeError("Transfer request must be an object.")
            image_ids = body.get("image_ids")
            if not isinstance(image_ids, list) or not image_ids:
                raise TypeError("Transfer image_ids must be a non-empty array.")
            if not all(isinstance(image_id, str) for image_id in image_ids):
                raise TypeError("Transfer image_ids must contain strings.")
            if len(set(image_ids)) != len(image_ids):
                raise ValueError("Transfer image_ids must be unique.")
            folder_id = body.get("folder")
            if not isinstance(folder_id, str):
                raise TypeError("Transfer folder must be a string.")
            destination_folder = next(
                (folder.path for folder in self.folders if folder.id == folder_id),
                None,
            )
            if destination_folder is None:
                raise web.HTTPNotFound(text="Unknown Image Shelf folder")
            if not destination_folder.is_dir():
                raise web.HTTPNotFound(text="Target folder does not exist")
            mode = body.get("mode", "copy")
            conflict = body.get("conflict", "suggest")
            filenames = body.get("filenames", {})
            if not isinstance(mode, str):
                raise TypeError("Transfer mode must be a string.")
            if not isinstance(conflict, str):
                raise TypeError("Transfer conflict must be a string.")
            if not isinstance(filenames, dict) or not all(
                isinstance(key, str) and isinstance(value, str)
                for key, value in filenames.items()
            ):
                raise TypeError("Transfer filenames must be an object of strings.")

            for image_id in image_ids:
                source = self.repository.path_for_public_id(image_id)
                if source is None or not any(
                    is_within_directory(source, folder)
                    for folder in self._tracked_paths()
                ):
                    raise web.HTTPNotFound(
                        text=f"Image not found or not within tracked folders: {image_id}"
                    )
                if is_within_directory(source, destination_folder):
                    raise web.HTTPBadRequest(
                        text="Image is already in the target folder"
                    )
                sources.append((image_id, source, filenames.get(image_id)))

            destinations = await asyncio.to_thread(
                transfer_files,
                [(source, filename) for _, source, filename in sources],
                destination_folder,
                mode,
                conflict,
            )
        except BatchFileConflictError as error:
            return web.json_response(
                {
                    "error": "filename_conflicts",
                    "conflicts": [
                        {
                            "image_id": sources[int(item["index"])][0],
                            "filename": item["filename"],
                            "suggested_filename": item["suggested_filename"],
                        }
                        for item in error.conflicts
                    ],
                },
                status=409,
            )
        except (FileNotFoundError, TypeError, ValueError) as error:
            raise web.HTTPBadRequest(text=str(error)) from error
        return web.json_response(
            {
                "folder": folder_id,
                "mode": mode,
                "items": [
                    {"image_id": image_id, "filename": destination.name}
                    for (image_id, _, _), destination in zip(sources, destinations)
                ],
            },
            status=201,
        )

    async def tags(self, request: web.Request) -> web.Response:
        folder = (
            self._folder_from_request(request) if request.query.get("folder") else None
        )
        return web.json_response(
            {
                "items": [
                    asdict(suggestion)
                    for suggestion in self.repository.suggest_tags(
                        self._paths_for_folder(folder) if folder else None,
                        request.query.get("q", ""),
                        limit=int(request.query.get("limit", "10")),
                    )
                ]
            }
        )

    async def reindex(self, request: web.Request) -> web.Response:
        folder = self._folder_from_request(request)
        force = request.query.get("force", "false").lower() == "true"
        path = folder.path
        task = self.indexing_tasks.get(path)
        if task is None or task.done():
            self.indexing_tasks[path] = self._create_indexing_task(path, force)
        return web.json_response({"accepted": True}, status=202)

    async def get_settings(self, request: web.Request) -> web.Response:
        return web.json_response(self.settings.as_dict())

    async def update_settings(self, request: web.Request) -> web.Response:
        try:
            settings = await request.json()
            if not isinstance(settings, dict):
                raise TypeError("Image Shelf settings must be an object.")
            self.settings.update(settings)
            await self.apply_settings()
        except (ValueError, TypeError) as error:
            raise web.HTTPBadRequest(text=str(error)) from error
        return web.json_response(self.settings.as_dict())

    async def folders_status(self, request: web.Request) -> web.Response:
        return web.json_response(
            {
                "items": [
                    {
                        "id": folder.id,
                        "name": folder.name,
                        "path": str(folder.path),
                        "editable": folder.editable,
                        "removable": folder.removable,
                        "indexing": bool(
                            (task := self.indexing_tasks.get(folder.path))
                            and not task.done()
                        ),
                        "error": str(self.indexing_errors[folder.path])
                        if folder.path in self.indexing_errors
                        else None,
                        "count": self.repository.list_images(
                            self._paths_for_folder(folder), page_size=1
                        ).total,
                    }
                    for folder in self.folders
                ]
            }
        )

    def _folder_from_request(self, request: web.Request) -> GalleryFolder:
        folder_id = request.query.get("folder", "outputs")
        for folder in self.folders:
            if folder.id == folder_id:
                return folder
        raise web.HTTPNotFound(text="Unknown Image Shelf folder")

    @staticmethod
    def _terms_from_request(request: web.Request) -> tuple[SearchTerm, ...]:
        try:
            terms = json.loads(request.query.get("terms", "[]"))
        except json.JSONDecodeError as error:
            raise ValueError(f"Invalid search terms: {error.msg}") from error
        if not isinstance(terms, list):
            raise TypeError("Search terms must be an array")
        try:
            return tuple(SearchTerm(**term) for term in terms)
        except (TypeError, KeyError) as error:
            raise ValueError("Invalid search term") from error

    def _paths_for_folder(self, folder: GalleryFolder) -> tuple[Path, ...]:
        return (folder.path,)

    def _tracked_paths(self) -> set[Path]:
        return {folder.path for folder in self.folders}


def create_gallery_app(
    database_path: str | Path,
    settings: ShelfSettings,
    allow_development_cors: bool = False,
) -> web.Application:
    repository = ImageRepository(database_path)
    api = GalleryApi(repository, settings)
    app = web.Application(
        middlewares=[_development_cors_middleware] if allow_development_cors else ()
    )
    app["image_shelf_api"] = api
    api.register(app)
    return app


@web.middleware
async def _development_cors_middleware(
    request: web.Request, handler: typedefs.Handler
) -> web.StreamResponse:
    origin = request.headers.get("Origin", "")
    allowed_origin = (
        origin if origin.startswith(("http://localhost:", "http://127.0.0.1:")) else ""
    )
    if request.method == "OPTIONS":
        response: web.StreamResponse = web.Response(status=204)
    else:
        try:
            response = await handler(request)
        except web.HTTPException as error:
            response = error
    if allowed_origin:
        response.headers["Access-Control-Allow-Origin"] = allowed_origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


def _parse_dimension(value: str) -> tuple[int, int]:
    try:
        width, height = value.lower().split("x", maxsplit=1)
        parsed = int(width), int(height)
    except ValueError as error:
        raise ValueError(f"Invalid dimension: {value}") from error
    if parsed[0] < 1 or parsed[1] < 1:
        raise ValueError(f"Invalid dimension: {value}")
    return parsed


def _reveal_in_file_explorer(path: Path) -> None:
    if sys.platform == "win32":
        subprocess.run(["explorer", "/select,", str(path)], check=True)
    elif sys.platform == "darwin":
        subprocess.run(["open", "-R", str(path)], check=True)
    else:
        subprocess.run(["xdg-open", str(path.parent)], check=True)


def _get_image_metadata(path: Path | str):
    with open(path, "rb") as file:
        return get_image_metadata(file.read())


def _pick_folder() -> str:
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.update_idletasks()
    root.attributes("-topmost", True)
    try:
        folder = filedialog.askdirectory(parent=root, mustexist=True)
        return folder
    finally:
        root.destroy()
