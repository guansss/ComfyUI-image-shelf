from __future__ import annotations

import importlib
import os
from pathlib import Path
from typing import Any


def normalize_path(path: str | Path) -> Path:
    """Return a resolved absolute path with platform-specific case normalization."""
    return Path(path).expanduser().resolve(strict=False)


def is_within_directory(path: str | Path, directory: str | Path) -> bool:
    """Return whether a path is contained by a configured directory."""
    normalized_path = normalize_path(path)
    normalized_directory = normalize_path(directory)
    try:
        normalized_path.relative_to(normalized_directory)
    except ValueError:
        return False
    return True


def resolve_comfy_asset(item: dict[str, Any]) -> Path:
    """Resolve a ComfyUI asset descriptor using ComfyUI's folder_paths module."""
    filename = item.get("filename")
    subfolder = item.get("subfolder", "")
    asset_type = item.get("type", "output")
    if not isinstance(filename, str) or not filename:
        raise ValueError("Asset filename must be a non-empty string.")
    if not isinstance(subfolder, str):
        raise TypeError("Asset subfolder must be a string.")
    if not isinstance(asset_type, str):
        raise TypeError("Asset type must be a string.")

    folder_paths = importlib.import_module("folder_paths")
    filename, output_dir = folder_paths.annotated_filepath(filename)
    if not filename:
        raise ValueError("Asset filename must be a non-empty string.")
    if filename[0] == "/" or ".." in filename:
        raise ValueError("Asset filename is invalid.")

    if output_dir is None:
        output_dir = folder_paths.get_directory_by_type(asset_type)
    if output_dir is None:
        raise ValueError("Asset type does not resolve to a ComfyUI folder.")

    if subfolder:
        full_output_dir = os.path.join(output_dir, subfolder)
        if os.path.commonpath(
            (os.path.abspath(full_output_dir), output_dir)
        ) != output_dir:
            raise ValueError("Asset subfolder must remain within its ComfyUI folder.")
        output_dir = full_output_dir

    return Path(os.path.join(output_dir, os.path.basename(filename)))
