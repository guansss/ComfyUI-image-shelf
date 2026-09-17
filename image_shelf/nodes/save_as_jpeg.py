from __future__ import annotations

from pathlib import Path
from typing import Any

import folder_paths  # pyrefly: ignore [missing-import]
from PIL import Image

from ..utils.jpeg import ExtensionVersion, save_jpeg_with_metadata


class SaveAsJPEG:
    """Save ComfyUI IMAGE tensors as JPEG files while preserving workflow metadata."""

    OUTPUT_NODE = True
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    FUNCTION = "save_images"
    CATEGORY = "Image Shelf"

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, dict[str, object]]:
        return {
            "required": {
                "images": ("IMAGE",),
                "quality": ("INT", {"default": 95, "min": 1, "max": 100, "step": 1}),
                "output_folder": ("STRING", {"default": "", "multiline": False}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    def save_images(
        self,
        images: Any,
        quality: int,
        output_folder: str,
        prompt: dict[str, Any] | None = None,
        extra_pnginfo: dict[str, Any] | None = None,
    ) -> dict[str, object]:
        destination = _output_destination(output_folder)
        destination.mkdir(parents=True, exist_ok=True)
        width, height = _image_dimensions(images[0])
        save_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            "image_shelf", str(destination), width, height
        )

        saved_images: list[dict[str, str]] = []
        for tensor in images:
            image_path = Path(save_folder) / f"{filename}_{counter:05}.jpg"
            image = _tensor_to_pillow(tensor)
            save_jpeg_with_metadata(
                image=image,
                output_path=str(image_path),
                metadata={
                    "prompt": prompt,
                    **(extra_pnginfo or {}),
                },
                extension_version=ExtensionVersion(0, 1, 0),
                quality=quality,
            )
            saved_images.append(
                {"filename": image_path.name, "subfolder": subfolder, "type": "output"}
            )
            counter += 1

        return {"ui": {"images": saved_images}, "result": (images,)}


def _output_destination(output_folder: str) -> Path:
    relative_path = Path(output_folder.strip()) if output_folder.strip() else Path()
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise ValueError("Output folder must be a relative path within ComfyUI output.")
    return Path(folder_paths.get_output_directory()) / relative_path


def _image_dimensions(image: Any) -> tuple[int, int]:
    height, width = image.shape[:2]
    return int(width), int(height)


def _tensor_to_pillow(image: Any) -> Image.Image:
    pixels = (
        image.detach().cpu().clamp(0, 1).mul(255).round().to(dtype=image.dtype).numpy()
    )
    return Image.fromarray(pixels.astype("uint8"), mode="RGB")
