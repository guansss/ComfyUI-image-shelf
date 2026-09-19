import os
from typing import TYPE_CHECKING

import folder_paths  # pyrefly: ignore [missing-import]
import nodes  # pyrefly: ignore [missing-import]
import server  # pyrefly: ignore [missing-import]
from aiohttp import web

if TYPE_CHECKING:
    from image_shelf.api import GalleryApi
    from image_shelf.configuration import (
        ShelfSettings,
        load_settings_path,
        set_settings,
    )
    from image_shelf.database import ImageRepository
    from image_shelf.log import logger
    from image_shelf.nodes.save_as_jpeg import SaveAsJPEG
    from image_shelf.nodes.send_to_folder import SendToFolder
else:
    from .image_shelf.api import GalleryApi
    from .image_shelf.configuration import (
        ShelfSettings,
        load_settings_path,
        set_settings,
    )
    from .image_shelf.database import ImageRepository
    from .image_shelf.log import logger
    from .image_shelf.nodes.save_as_jpeg import SaveAsJPEG
    from .image_shelf.nodes.send_to_folder import SendToFolder


NODE_CLASS_MAPPINGS = {
    "ImageShelfSaveAsJPEG": SaveAsJPEG,
    "ImageShelfSendToFolder": SendToFolder,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageShelfSaveAsJPEG": "Save as JPEG",
    "ImageShelfSendToFolder": "Send to Folder",
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


def launch_gallery() -> None:
    app = server.PromptServer.instance.app
    app.on_startup.append(_on_server_start)

    repository = ImageRepository(database_path)
    settings = ShelfSettings(
        output_folder=folder_paths.get_output_directory(),
        settings_path=load_settings_path(),
    )
    settings.load()
    set_settings(settings)
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
        from comfy_config import config_parser  # pyrefly: ignore [missing-import]

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
