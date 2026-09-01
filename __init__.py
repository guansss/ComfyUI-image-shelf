import asyncio
import os

import server
from aiohttp import web
import folder_paths
import nodes

from .image_shelf.api import GalleryApi
from .image_shelf.database import ImageRepository
from .image_shelf.models import GalleryTab
from .image_shelf.nodes import SaveAsJPEG, SendToFavorites

NODE_CLASS_MAPPINGS = {
    "ImageShelfSaveAsJPEG": SaveAsJPEG,
    "ImageShelfSendToFavorites": SendToFavorites,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageShelfSaveAsJPEG": "Save as JPEG",
    "ImageShelfSendToFavorites": "Send to Favorites",
}
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

workspace_path = os.path.dirname(__file__)
dist_path = os.path.join(workspace_path, "dist/image_shelf")
dist_locales_path = os.path.join(workspace_path, "dist/locales")
database_path = os.path.join(workspace_path, "image-shelf.sqlite3")


def register_gallery_api() -> None:
    app = server.PromptServer.instance.app
    repository = ImageRepository(database_path)
    api = GalleryApi(
        repository,
        [
            GalleryTab("outputs", "Outputs", (folder_paths.get_output_directory(),)),
            GalleryTab("favorites", "Favorites", (), editable=True),
        ],
    )
    app["image_shelf_api"] = api
    api.register(app)

    for folder in api._tracked_folders():
        api.indexing_tasks[folder] = asyncio.get_event_loop().create_task(
            api.indexer.index_folder(folder)
        )
    api.start_monitoring(asyncio.get_event_loop())


register_gallery_api()

if os.path.exists(dist_path):
    server.PromptServer.instance.app.add_routes([
        web.static("/image_shelf/", dist_path),
    ])

    if os.path.exists(dist_locales_path):
        server.PromptServer.instance.app.add_routes([
            web.static("/locales/", dist_locales_path),
        ])

    project_name = os.path.basename(workspace_path)

    try:
        from comfy_config import config_parser

        project_config = config_parser.extract_node_configuration(workspace_path)
        project_name = project_config.project.name
    except Exception:
        pass

    nodes.EXTENSION_WEB_DIRS[project_name] = os.path.join(workspace_path, "dist")