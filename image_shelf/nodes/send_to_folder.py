from __future__ import annotations

from typing import Any

from ..configuration import get_settings


class SendToFolder:
    """Pass images through while the frontend sends the upstream saved files to a folder."""

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    FUNCTION = "execute"
    CATEGORY = "Image Shelf"

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, dict[str, object]]:
        settings = get_settings()
        folders = settings.settings.custom_folders if settings else []

        return {
            "required": {
                "images": ("IMAGE",),
                "folder": ([folder.id for folder in folders],),
                "send_mode": (["copy", "move"], {"default": "copy"}),
            }
        }

    def execute(self, images: Any, *args) -> tuple[Any]:
        return (images,)
