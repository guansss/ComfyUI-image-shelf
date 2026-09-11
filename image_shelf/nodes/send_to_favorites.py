from __future__ import annotations

from typing import Any


class SendToFavorites:
    """Pass images through while the frontend sends the upstream saved files to Favorites."""

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    FUNCTION = "pass_through"
    CATEGORY = "Image Shelf"

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, dict[str, object]]:
        return {
            "required": {
                "images": ("IMAGE",),
                "mode": (["copy", "move"], {"default": "copy"}),
            }
        }

    def pass_through(self, images: Any, mode: str) -> tuple[Any]:
        if mode not in {"copy", "move"}:
            raise ValueError("Favorites transfer mode must be copy or move.")
        return (images,)
