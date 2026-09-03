from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import dotenv_values

from .models import GalleryTab
from .paths import normalize_path


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
    output_folder = normalize_path(_required_var("COMFYUI_OUTPUT_FOLDER"))
    return StandaloneConfiguration(
        port=port,
        comfyui_path=comfyui_path,
        output_folder=output_folder,
        settings_path=comfyui_path / "user" / "default" / "comfy.settings.json",
    )


def load_standalone_tabs(configuration: StandaloneConfiguration) -> list[GalleryTab]:
    settings = _load_settings(configuration.settings_path)
    return tabs_from_settings(configuration.output_folder, settings)


def tabs_from_settings(
    output_folder: str | Path, settings: dict[str, Any]
) -> list[GalleryTab]:
    favorites_folder = _as_path(settings.get("image-shelf.favorites-folder"))
    custom_tabs = _parse_custom_tabs(settings.get("image-shelf.custom-tabs"))
    return [
        GalleryTab("outputs", "Outputs", (normalize_path(output_folder),)),
        GalleryTab(
            "favorites",
            "Favorites",
            (favorites_folder,) if favorites_folder else (),
            editable=True,
        ),
        *custom_tabs,
    ]


def _required_var(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise ValueError(f"{name} is required in .env for standalone mode.")
    return value


def _load_settings(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        content = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return content if isinstance(content, dict) else {}


def _parse_custom_tabs(value: Any) -> list[GalleryTab]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return []
    if not isinstance(value, list):
        return []

    tabs: list[GalleryTab] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        tab_id = item.get("id")
        name = item.get("name")
        folder = _as_path(item.get("folder"))
        if isinstance(tab_id, str) and isinstance(name, str) and folder:
            tabs.append(
                GalleryTab(tab_id, name, (folder,), editable=True, removable=True)
            )
    return tabs


def _as_path(value: Any) -> Path | None:
    return normalize_path(value) if isinstance(value, str) and value.strip() else None
