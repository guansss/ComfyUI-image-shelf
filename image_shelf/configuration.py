from __future__ import annotations

import json
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import dotenv_values

from .log import logger
from .models import GalleryFolder
from .paths import normalize_path


class ShelfSettings:
    def __init__(
        self, output_folder: Path, comfy_settings_loader: Callable[[], dict[str, Any]]
    ) -> None:
        self.output_folder = output_folder
        self._comfy_settings_loader = comfy_settings_loader
        self.comfy_settings = {}

    def load_comfy_settings(self) -> None:
        self.comfy_settings = self._comfy_settings_loader()

    def update_comfy_settings(self, new_settings: dict[str, Any]) -> None:
        self.comfy_settings = {
            **self.comfy_settings,
            **new_settings,
        }

    def get_folders(self) -> list[GalleryFolder]:
        custom_folders = _parse_custom_folders(
            self.comfy_settings.get("image-shelf.custom-folders")
        )
        return [
            GalleryFolder(
                "outputs",
                "Outputs",
                self.output_folder,
            ),
            *custom_folders,
        ]

    def get_favorites_folder(self) -> Path | None:
        return _as_path(self.comfy_settings.get("image-shelf.favorites-folder"))


@dataclass(frozen=True)
class StandaloneConfiguration:
    port: int
    comfyui_path: Path
    output_folder: Path
    settings_path: Path


def load_standalone_configuration(
    env_path: str | Path = ".env",
) -> StandaloneConfiguration:
    env = {
        **dotenv_values(env_path),
        **dotenv_values(".env.local"),
    }
    {os.environ.setdefault(k, v) for k, v in env.items() if v is not None}
    port = int(_required_var("BACKEND_STANDALONE_PORT"))
    comfyui_path = normalize_path(_required_var("COMFYUI_PATH"))
    output_folder = normalize_path(
        _required_var("COMFYUI_OUTPUT_FOLDER", default=str(comfyui_path / "output"))
    )
    settings_path = normalize_path(
        _required_var(
            "COMFYUI_SETTINGS_PATH",
            default=str(comfyui_path / "user" / "default" / "comfy.settings.json"),
        )
    )
    return StandaloneConfiguration(
        port=port,
        comfyui_path=comfyui_path,
        output_folder=output_folder,
        settings_path=settings_path,
    )


def load_standalone_comfy_settings(
    configuration: StandaloneConfiguration,
) -> dict[str, Any]:
    path = configuration.settings_path
    if not path.is_file():
        logger.error(f"Settings file {path} does not exist.")
        return {}
    try:
        content = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        logger.error(f"Failed to load settings from {path}.")
        return {}
    if not isinstance(content, dict):
        logger.error(f"Settings file {path} is not a valid JSON object.")
        return {}
    return content


def _required_var(name: str, default: str | None = None) -> str:
    value = os.getenv(name)
    if not value:
        if default is not None:
            return default
        raise ValueError(f"{name} is required in .env for standalone mode.")
    return value


def _parse_custom_folders(value: Any) -> list[GalleryFolder]:
    if not isinstance(value, list):
        logger.warning(
            "Expected a list for custom folders, but got: %s", type(value).__name__
        )
        return []

    folders: list[GalleryFolder] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        folder_id = item.get("id")
        name = item.get("name")
        path = _as_path(item.get("path"))
        if isinstance(folder_id, str) and path is not None:
            name = isinstance(name, str) and name or f"???{folder_id}"
            folders.append(
                GalleryFolder(
                    folder_id,
                    name,
                    path,
                    editable=True,
                    removable=True,
                )
            )
    return folders


def _as_path(value: Any) -> Path | None:
    return normalize_path(value) if isinstance(value, str) and value.strip() else None
