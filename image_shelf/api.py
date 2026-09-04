from __future__ import annotations

import asyncio
import subprocess
import sys
from dataclasses import asdict
from pathlib import Path

from aiohttp import web

from .configuration import ShelfSettings
from .database import ImageRepository
from .favorites import FileConflictError, transfer_to_favorites
from .indexer import FolderIndexer, IndexingResult
from .log import logger
from .models import GalleryTab
from .paths import is_within_directory, normalize_path
from .watcher import FolderWatcher


class GalleryApi:
    def __init__(
        self,
        repository: ImageRepository,
        settings: ShelfSettings,
    ) -> None:
        self.repository = repository
        self.settings = settings
        self.tabs: list[GalleryTab] = []
        self.indexer = FolderIndexer(repository)
        self.indexing_tasks: dict[Path, asyncio.Task[IndexingResult]] = {}
        self.indexing_errors: dict[Path, Exception] = {}
        self.folder_picker_tasks: set[asyncio.Task[None]] = set()
        self.websocket_clients: set[web.WebSocketResponse] = set()
        self.watcher: FolderWatcher | None = None

    async def apply_settings(self) -> None:
        await self._replace_and_reindex(self.settings.get_tabs())

    async def _replace_and_reindex(self, tabs: list[GalleryTab]) -> None:
        previous_folders = self._tracked_folders()
        self.tabs = self._normalize_tabs(tabs)
        current_folders = self._tracked_folders()
        for folder in previous_folders - current_folders:
            task = self.indexing_tasks.pop(folder, None)
            if task and not task.done():
                task.cancel()
            self.indexing_errors.pop(folder, None)
        self.repository.delete_untracked_paths(current_folders)
        if self.watcher:
            self.watcher.reconfigure(current_folders)
        await self._broadcast(
            "tabsUpdated", {"tabs": [tab.dict() for tab in self.tabs]}
        )
        await self._index_folders(current_folders - previous_folders)

    async def _index_folders(self, folders: set[Path]) -> None:
        for folder in folders:
            task = self.indexing_tasks.get(folder)
            if task is None or task.done():
                self.indexing_tasks[folder] = self._create_indexing_task(folder)

    def _create_indexing_task(self, folder: Path) -> asyncio.Task[IndexingResult]:
        task = asyncio.create_task(self._index_folder_and_broadcast(folder))
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

    async def _index_folder_and_broadcast(self, folder: Path) -> IndexingResult:
        tab_ids = tuple(tab.id for tab in self.tabs if folder in tab.folders)
        for tab_id in tab_ids:
            await self._broadcast("indexStart", {"tab": tab_id})

        try:
            result = await self.indexer.index_folder(folder)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            for tab_id in tab_ids:
                await self._broadcast(
                    "indexFinish", {"tab": tab_id, "error": str(error)}
                )
            raise

        for tab_id in tab_ids:
            await self._broadcast(
                "indexFinish", {"tab": tab_id, "result": asdict(result)}
            )
        return result

    async def start(self, loop: asyncio.AbstractEventLoop) -> None:
        logger.info("Starting Image Shelf API")
        if self.watcher is None:
            self.watcher = FolderWatcher(self._index_folder_and_broadcast, loop)
            self.watcher.start()
        self.settings.load_comfy_settings()
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
    def _normalize_tabs(tabs: list[GalleryTab]) -> tuple[GalleryTab, ...]:
        return tuple(
            GalleryTab(
                id=tab.id,
                name=tab.name,
                folders=tuple(
                    dict.fromkeys(normalize_path(folder) for folder in tab.folders)
                ),
                editable=tab.editable,
                removable=tab.removable,
            )
            for tab in tabs
        )

    def register(self, app: web.Application, register_startup: bool = True) -> None:
        app.add_routes(
            [
                web.get("/api/image-shelf/v1/tabs", self.tabs_status),
                web.get("/api/image-shelf/v1/images", self.list_images),
                web.get("/api/image-shelf/v1/images/{image_id}", self.image_details),
                web.post(
                    "/api/image-shelf/v1/images/{image_id}/favorite",
                    self.send_to_favorites,
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
                web.get("/api/image-shelf/v1/dimensions", self.dimensions),
                web.get("/api/image-shelf/v1/tags", self.tags),
                web.post("/api/image-shelf/v1/settings", self.update_settings),
                web.post("/api/image-shelf/v1/settings/reload", self.reload_settings),
                web.post("/api/image-shelf/v1/reindex", self.reindex),
                web.get("/api/image-shelf/v1/status", self.tabs_status),
            ]
        )
        if register_startup:
            app.on_startup.append(lambda app: self.start(asyncio.get_running_loop()))
        app.on_shutdown.append(lambda app: self.shutdown_websockets())
        app.on_cleanup.append(lambda app: self.shutdown())

    async def list_images(self, request: web.Request) -> web.Response:
        try:
            tab = self._tab_from_request(request)
            dimensions = tuple(
                _parse_dimension(value)
                for value in request.query.getall("dimension", [])
            )
            page = self.repository.list_images(
                self._folders_for_tab(tab),
                query=request.query.get("query", ""),
                dimensions=dimensions,
                sort_by=request.query.get("sort", "created_at"),
                direction=request.query.get("direction", "desc"),
                page=int(request.query.get("page", "1")),
                page_size=int(request.query.get("page_size", "100")),
            )
        except ValueError as error:
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
            }
        )

    async def image_file(self, request: web.Request) -> web.StreamResponse:
        path = self.repository.path_for_public_id(request.match_info["image_id"])
        if (
            path is None
            or not path.is_file()
            or not any(
                is_within_directory(path, folder) for folder in self._tracked_folders()
            )
        ):
            raise web.HTTPNotFound()
        return web.FileResponse(path)

    async def image_details(self, request: web.Request) -> web.Response:
        image = self.repository.image_details(request.match_info["image_id"])
        if image is None or not any(
            is_within_directory(self.repository.path_for_public_id(image.id), folder)
            for folder in self._tracked_folders()
        ):
            raise web.HTTPNotFound()
        return web.json_response(asdict(image))

    async def reveal_image(self, request: web.Request) -> web.Response:
        path = self.repository.path_for_public_id(request.match_info["image_id"])
        if (
            path is None
            or not path.is_file()
            or not any(
                is_within_directory(path, folder) for folder in self._tracked_folders()
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

    async def _broadcast(self, event: str, data: dict[str, object]) -> None:
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

    async def send_to_favorites(self, request: web.Request) -> web.Response:
        source = self.repository.path_for_public_id(request.match_info["image_id"])
        favorites_folder = next(
            (
                folder
                for tab in self.tabs
                if tab.id == "favorites"
                for folder in tab.folders
            ),
            None,
        )
        if source is None or not any(
            is_within_directory(source, folder) for folder in self._tracked_folders()
        ):
            raise web.HTTPNotFound()
        if favorites_folder is None:
            raise web.HTTPBadRequest(text="Favorites folder is not configured.")
        try:
            body = await request.json()
            mode = body.get("mode", "copy")
            filename = body.get("filename")
            if filename is not None and not isinstance(filename, str):
                raise ValueError("Favorites filename must be a string.")
            destination = await asyncio.to_thread(
                transfer_to_favorites, source, favorites_folder, mode, filename
            )
        except FileConflictError as error:
            return web.json_response(
                {
                    "error": "filename_conflict",
                    "suggested_filename": error.suggested_name,
                },
                status=409,
            )
        except (FileNotFoundError, ValueError) as error:
            raise web.HTTPBadRequest(text=str(error)) from error
        return web.json_response(
            {"filename": destination.name, "mode": mode}, status=201
        )

    async def dimensions(self, request: web.Request) -> web.Response:
        try:
            tab = self._tab_from_request(request)
            facets = self.repository.dimension_facets(
                self._folders_for_tab(tab), request.query.get("query", "")
            )
        except ValueError as error:
            raise web.HTTPBadRequest(text=str(error)) from error
        return web.json_response({"items": [asdict(facet) for facet in facets]})

    async def tags(self, request: web.Request) -> web.Response:
        tab = self._tab_from_request(request)
        return web.json_response(
            {
                "items": [
                    asdict(suggestion)
                    for suggestion in self.repository.suggest_tags(
                        self._folders_for_tab(tab), request.query.get("q", "")
                    )
                ]
            }
        )

    async def reindex(self, request: web.Request) -> web.Response:
        tab = self._tab_from_request(request)
        for folder in self._folders_for_tab(tab):
            task = self.indexing_tasks.get(folder)
            if task is None or task.done():
                self.indexing_tasks[folder] = self._create_indexing_task(folder)
        return web.json_response({"accepted": True}, status=202)

    async def reload_settings(self, request: web.Request) -> web.Response:
        try:
            self.settings.load_comfy_settings()
            await self.apply_settings()
        except ValueError as error:
            raise web.HTTPNotImplemented(text=str(error)) from error
        return web.json_response({"accepted": True}, status=202)

    async def update_settings(self, request: web.Request) -> web.Response:
        try:
            settings = await request.json()
            if not isinstance(settings, dict):
                raise TypeError("Image Shelf settings must be an object.")
            self.settings.update_comfy_settings(settings)
            await self.apply_settings()
        except (ValueError, TypeError) as error:
            raise web.HTTPBadRequest(text=str(error)) from error
        return web.json_response({"accepted": True}, status=202)

    async def tabs_status(self, request: web.Request) -> web.Response:
        return web.json_response(
            {
                "items": [
                    {
                        "id": tab.id,
                        "name": tab.name,
                        "folders": [str(folder) for folder in tab.folders],
                        "editable": tab.editable,
                        "removable": tab.removable,
                        "indexing": bool(
                            any(
                                (task := self.indexing_tasks.get(folder))
                                and not task.done()
                                for folder in tab.folders
                            )
                        ),
                        "error": next(
                            (
                                str(self.indexing_errors[folder])
                                for folder in tab.folders
                                if folder in self.indexing_errors
                            ),
                            None,
                        ),
                        "count": self.repository.list_images(
                            self._folders_for_tab(tab), page_size=1
                        ).total,
                    }
                    for tab in self.tabs
                ]
            }
        )

    def _tab_from_request(self, request: web.Request) -> GalleryTab:
        tab_id = request.query.get("tab", "outputs")
        for tab in self.tabs:
            if tab.id == tab_id:
                return tab
        raise web.HTTPNotFound(text="Unknown Image Shelf tab")

    def _folders_for_tab(self, tab: GalleryTab) -> tuple[Path, ...]:
        return tab.folders

    def _tracked_folders(self) -> set[Path]:
        return {folder for tab in self.tabs for folder in tab.folders}


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
    request: web.Request, handler: web.Handler
) -> web.StreamResponse:
    origin = request.headers.get("Origin", "")
    allowed_origin = (
        origin if origin.startswith(("http://localhost:", "http://127.0.0.1:")) else ""
    )
    if request.method == "OPTIONS":
        response: web.StreamResponse = web.Response(status=204)
    else:
        response = await handler(request)
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
