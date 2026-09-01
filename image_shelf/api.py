from __future__ import annotations

import asyncio
import subprocess
import sys
from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path

from aiohttp import web

from .database import ImageRepository
from .favorites import FileConflictError, transfer_to_favorites
from .indexer import FolderIndexer, IndexingResult
from .models import GalleryTab
from .paths import is_within_directory, normalize_path
from .watcher import FolderWatcher
from .configuration import tabs_from_settings


class GalleryApi:
    def __init__(
        self,
        repository: ImageRepository,
        tabs: list[GalleryTab],
        tab_reloader: Callable[[], list[GalleryTab]] | None = None,
    ) -> None:
        self.repository = repository
        self.tabs = self._normalize_tabs(tabs)
        self.output_folders = tuple(
            folder for tab in self.tabs if tab.id == "outputs" for folder in tab.folders
        )
        self.tab_reloader = tab_reloader
        self.indexer = FolderIndexer(repository)
        self.indexing_tasks: dict[Path, asyncio.Task[IndexingResult]] = {}
        self.watcher: FolderWatcher | None = None

    def replace_tabs(self, tabs: list[GalleryTab]) -> None:
        self.tabs = self._normalize_tabs(tabs)

    async def reload_tabs(self) -> None:
        if self.tab_reloader is None:
            raise ValueError("This backend does not support settings reload.")
        previous_folders = set(self._tracked_folders())
        self.replace_tabs(self.tab_reloader())
        current_folders = set(self._tracked_folders())
        for folder in previous_folders - current_folders:
            task = self.indexing_tasks.pop(folder, None)
            if task and not task.done():
                task.cancel()
        self.repository.delete_untracked_paths(current_folders)
        if self.watcher:
            self.watcher.reconfigure(tuple(current_folders))
        for folder in current_folders:
            task = self.indexing_tasks.get(folder)
            if task is None or task.done():
                self.indexing_tasks[folder] = asyncio.create_task(
                    self.indexer.index_folder(folder)
                )

    async def apply_settings(self, settings: dict[str, object]) -> None:
        await self._replace_and_reindex(tabs_from_settings(self.output_folders[0], settings))

    async def _replace_and_reindex(self, tabs: list[GalleryTab]) -> None:
        previous_folders = set(self._tracked_folders())
        self.replace_tabs(tabs)
        current_folders = set(self._tracked_folders())
        for folder in previous_folders - current_folders:
            task = self.indexing_tasks.pop(folder, None)
            if task and not task.done():
                task.cancel()
        self.repository.delete_untracked_paths(current_folders)
        if self.watcher:
            self.watcher.reconfigure(tuple(current_folders))
        for folder in current_folders:
            task = self.indexing_tasks.get(folder)
            if task is None or task.done():
                self.indexing_tasks[folder] = asyncio.create_task(
                    self.indexer.index_folder(folder)
                )

    def start_monitoring(self, loop: asyncio.AbstractEventLoop) -> None:
        if self.watcher is None:
            self.watcher = FolderWatcher(self.indexer, loop)
            self.watcher.start(self._tracked_folders())
        else:
            self.watcher.reconfigure(self._tracked_folders())

    def stop_monitoring(self) -> None:
        if self.watcher:
            self.watcher.stop()
            self.watcher = None

    @staticmethod
    def _normalize_tabs(tabs: list[GalleryTab]) -> tuple[GalleryTab, ...]:
        return tuple(
            GalleryTab(
                id=tab.id,
                name=tab.name,
                folders=tuple(dict.fromkeys(normalize_path(folder) for folder in tab.folders)),
                editable=tab.editable,
                removable=tab.removable,
            )
            for tab in tabs
        )

    def register(self, app: web.Application) -> None:
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
        if path is None or not path.is_file() or not any(
            is_within_directory(path, folder) for folder in self._tracked_folders()
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
        if path is None or not path.is_file() or not any(
            is_within_directory(path, folder) for folder in self._tracked_folders()
        ):
            raise web.HTTPNotFound()
        try:
            await asyncio.to_thread(_reveal_in_file_explorer, path)
        except OSError as error:
            raise web.HTTPInternalServerError(text=str(error)) from error
        return web.json_response({"accepted": True})

    async def send_to_favorites(self, request: web.Request) -> web.Response:
        source = self.repository.path_for_public_id(request.match_info["image_id"])
        favorites_folder = next(
            (folder for tab in self.tabs if tab.id == "favorites" for folder in tab.folders),
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
                {"error": "filename_conflict", "suggested_filename": error.suggested_name},
                status=409,
            )
        except (FileNotFoundError, ValueError) as error:
            raise web.HTTPBadRequest(text=str(error)) from error
        return web.json_response({"filename": destination.name, "mode": mode}, status=201)

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
                "items": list(
                    asdict(
                        suggestion
                    )
                    for suggestion in self.repository.suggest_tags(
                        self._folders_for_tab(tab), request.query.get("q", "")
                    )
                )
            }
        )

    async def reindex(self, request: web.Request) -> web.Response:
        tab = self._tab_from_request(request)
        for folder in self._folders_for_tab(tab):
            task = self.indexing_tasks.get(folder)
            if task is None or task.done():
                self.indexing_tasks[folder] = asyncio.create_task(
                    self.indexer.index_folder(folder)
                )
        return web.json_response({"accepted": True}, status=202)

    async def reload_settings(self, request: web.Request) -> web.Response:
        try:
            await self.reload_tabs()
        except ValueError as error:
            raise web.HTTPNotImplemented(text=str(error)) from error
        return web.json_response({"accepted": True}, status=202)

    async def update_settings(self, request: web.Request) -> web.Response:
        try:
            settings = await request.json()
            if not isinstance(settings, dict):
                raise TypeError("Image Shelf settings must be an object.")
            await self.apply_settings(settings)
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
                        "configured": bool(tab.folders),
                        "editable": tab.editable,
                        "removable": tab.removable,
                        "indexing": bool(
                            any(
                                (task := self.indexing_tasks.get(folder)) and not task.done()
                                for folder in tab.folders
                            )
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

    def _tracked_folders(self) -> tuple[Path, ...]:
        return tuple(dict.fromkeys(folder for tab in self.tabs for folder in tab.folders))


def create_gallery_app(
    database_path: str | Path,
    folders: list[str | Path] | None = None,
    tabs: list[GalleryTab] | None = None,
    allow_development_cors: bool = False,
    tab_reloader: Callable[[], list[GalleryTab]] | None = None,
) -> web.Application:
    repository = ImageRepository(database_path)
    api = GalleryApi(
        repository,
        tabs
        if tabs is not None
        else [
            GalleryTab(
                "outputs",
                "Outputs",
                tuple(normalize_path(folder) for folder in folders or ()),
            ),
            GalleryTab("favorites", "Favorites", (), editable=True),
        ],
        tab_reloader,
    )
    app = web.Application(
        middlewares=[_development_cors_middleware] if allow_development_cors else ()
    )
    app["image_shelf_api"] = api
    app.on_startup.append(_start_initial_index)
    app.on_cleanup.append(_close_repository)
    api.register(app)
    return app


async def _start_initial_index(app: web.Application) -> None:
    api: GalleryApi = app["image_shelf_api"]
    for folder in api._tracked_folders():
        api.indexing_tasks[folder] = asyncio.create_task(api.indexer.index_folder(folder))
    api.start_monitoring(asyncio.get_running_loop())


async def _close_repository(app: web.Application) -> None:
    api: GalleryApi = app["image_shelf_api"]
    api.stop_monitoring()
    active_tasks = [task for task in api.indexing_tasks.values() if not task.done()]
    for task in active_tasks:
        task.cancel()
    if active_tasks:
        await asyncio.gather(*active_tasks, return_exceptions=True)
    api.repository.close()


@web.middleware
async def _development_cors_middleware(
    request: web.Request, handler: web.Handler
) -> web.StreamResponse:
    origin = request.headers.get("Origin", "")
    allowed_origin = origin if origin.startswith(("http://localhost:", "http://127.0.0.1:")) else ""
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