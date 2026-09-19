from __future__ import annotations

import shutil
from pathlib import Path


class FileConflictError(Exception):
    def __init__(self, suggested_name: str) -> None:
        self.suggested_name = suggested_name
        super().__init__(f"A file named {suggested_name} already exists.")


def transfer_file(
    source: Path, destination_folder: Path, mode: str, filename: str | None = None
) -> Path:
    if mode not in {"copy", "move"}:
        raise ValueError("Transfer mode must be copy or move.")
    if not source.is_file():
        raise FileNotFoundError("Indexed image file no longer exists.")
    destination_folder.mkdir(parents=True, exist_ok=True)
    destination_name = _safe_filename(filename or source.name)
    destination = destination_folder / destination_name
    if destination.exists():
        raise FileConflictError(_suggest_filename(destination_folder, destination_name))
    if mode == "copy":
        shutil.copy2(source, destination)
    else:
        shutil.move(source, destination)
    return destination


def _safe_filename(value: str) -> str:
    filename = Path(value).name
    if not filename or filename != value:
        raise ValueError("Transfer filename must not contain a path.")
    return filename


def _suggest_filename(destination_folder: Path, filename: str) -> str:
    path = Path(filename)
    index = 1
    while True:
        candidate = f"{path.stem}_{index}{path.suffix}"
        if not (destination_folder / candidate).exists():
            return candidate
        index += 1
