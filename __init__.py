import os
from typing import Any

import folder_paths
import nodes
import server
from aiohttp import web
from aiohttp.test_utils import make_mocked_request

from .image_shelf.api import GalleryApi
from .image_shelf.configuration import ShelfSettings
from .image_shelf.database import ImageRepository
from .image_shelf.log import logger
from .image_shelf.nodes.save_as_jpeg import SaveAsJPEG
from .image_shelf.nodes.send_to_favorites import SendToFavorites

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
dist_path = os.path.join(workspace_path, "dist")
dist_locales_path = os.path.join(workspace_path, "dist/locales")
database_path = os.path.join(workspace_path, "image-shelf.sqlite3")

server_started = False


async def _on_server_start(app: web.Application) -> None:
    global server_started
    server_started = True


def get_comfy_settings() -> dict[str, Any]:
    if not server_started:
        logger.warning(
            "Attempting to load Comfy settings before the server has started. This may cause issues."
        )
    req = make_mocked_request("GET", "/settings")
    return server.PromptServer.instance.user_manager.settings.get_settings(req)


def launch_gallery() -> None:
    app = server.PromptServer.instance.app
    app.on_startup.append(_on_server_start)

    repository = ImageRepository(database_path)
    settings = ShelfSettings(
        output_folder=folder_paths.get_output_directory(),
        comfy_settings_loader=get_comfy_settings,
    )
    api = GalleryApi(repository, settings)
    app["image_shelf_api"] = api
    api.register(app)


launch_gallery()


logger.info(f"Initialized. Database path: {database_path}")

if os.path.exists(dist_path):
    server.PromptServer.instance.app.add_routes(
        [
            web.static("/image_shelf/", dist_path),
        ]
    )

    if os.path.exists(dist_locales_path):
        server.PromptServer.instance.app.add_routes(
            [
                web.static("/locales/", dist_locales_path),
            ]
        )

    project_name = os.path.basename(workspace_path)

    try:
        from comfy_config import config_parser

        project_config = config_parser.extract_node_configuration(workspace_path)
        project_name = project_config.project.name
    except Exception as e:
        logger.warning(
            f"Could not load project config, using default name '{project_name}': {e}"
        )

    nodes.EXTENSION_WEB_DIRS[project_name] = os.path.join(workspace_path, "dist")
else:
    logger.error(
        f"[Image Shelf] dist directory not found at {dist_path}. Did you forget to build the frontend (npm run build)?"
    )
