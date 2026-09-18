from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import dotenv_values
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .log import logger
from .models import GalleryFolder
from .paths import normalize_path


class CustomFolderSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str | None = None
    path: str

    @field_validator("id", "path")
    @classmethod
    def require_non_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be empty")
        return value


class ImageShelfSettingsModel(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    custom_folders: list[CustomFolderSettings] = Field(
        default_factory=list, alias="custom_folders"
    )


class ShelfSettings:
    def __init__(self, output_folder: Path, settings_path: Path) -> None:
        self.output_folder = output_folder
        self.settings_path = settings_path
        self.settings = ImageShelfSettingsModel()

    def load(self) -> None:
        if not self.settings_path.is_file():
            self.settings = ImageShelfSettingsModel()
            return
        try:
            content = json.loads(self.settings_path.read_text(encoding="utf-8"))
            self.settings = ImageShelfSettingsModel.model_validate(content)
        except (OSError, json.JSONDecodeError, ValidationError, TypeError) as error:
            raise ValueError(
                f"Failed to load settings from {self.settings_path}: {error}"
            ) from error

    def update(self, patch: dict[str, Any]) -> None:
        current = self.settings.model_dump(by_alias=True)
        merged = {**current, **patch}
        try:
            updated = ImageShelfSettingsModel.model_validate(merged)
            self.settings_path.parent.mkdir(parents=True, exist_ok=True)
            self.settings_path.write_text(
                json.dumps(updated.model_dump(by_alias=True), indent=2) + "\n",
                encoding="utf-8",
            )
        except (OSError, ValidationError, TypeError) as error:
            raise ValueError(f"Failed to update settings: {error}") from error
        self.settings = updated

    def as_dict(self) -> dict[str, Any]:
        return self.settings.model_dump(by_alias=True, exclude_none=True)

    def get_folders(self) -> list[GalleryFolder]:
        custom_folders = _parse_custom_folders(
            [folder.model_dump() for folder in self.settings.custom_folders]
        )
        return [
            GalleryFolder(
                "outputs",
                "Outputs",
                self.output_folder,
            ),
            *custom_folders,
        ]


_settings: ShelfSettings | None = None


def settings() -> ShelfSettings | None:
    return _settings


def set_settings(new_settings: ShelfSettings) -> None:
    global _settings
    _settings = new_settings


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
    settings_path = load_settings_path(env_path)
    return StandaloneConfiguration(
        port=port,
        comfyui_path=comfyui_path,
        output_folder=output_folder,
        settings_path=settings_path,
    )


def load_settings_path(env_path: str | Path = ".env") -> Path:
    env = {
        **dotenv_values(env_path),
        **dotenv_values(".env.local"),
    }
    {os.environ.setdefault(k, v) for k, v in env.items() if v is not None}
    return normalize_path(
        _required_var(
            "IMAGE_SHELF_SETTINGS_PATH",
            default=str(Path(__file__).resolve().parent.parent / "settings.json"),
        )
    )


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
