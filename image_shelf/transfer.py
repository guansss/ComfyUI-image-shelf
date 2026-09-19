from __future__ import annotations

import os
import shutil
import tempfile
from collections.abc import Sequence
from pathlib import Path


class FileConflictError(Exception):
    def __init__(self, suggested_name: str) -> None:
        self.suggested_name = suggested_name
        super().__init__(f"A file named {suggested_name} already exists.")


class BatchFileConflictError(Exception):
    def __init__(self, conflicts: list[dict[str, str]]) -> None:
        self.conflicts = conflicts
        super().__init__("One or more destination filenames are unavailable.")


def transfer_file(
    source: Path,
    destination_folder: Path,
    mode: str,
    filename: str | None = None,
    conflict: str = "suggest",
) -> Path:
    try:
        return transfer_files(
            [(source, filename)], destination_folder, mode, conflict=conflict
        )[0]
    except BatchFileConflictError as error:
        raise FileConflictError(error.conflicts[0]["suggested_filename"]) from error


def transfer_files(
    files: Sequence[tuple[Path, str | None]],
    destination_folder: Path,
    mode: str,
    conflict: str = "fail",
) -> list[Path]:
    if mode not in {"copy", "move"}:
        raise ValueError("Transfer mode must be copy or move.")
    if conflict not in {"rename", "suggest", "fail"}:
        raise ValueError("Transfer conflict must be rename, suggest, or fail.")
    if not files:
        raise ValueError("At least one file is required.")
    for source, _ in files:
        if not source.is_file():
            raise FileNotFoundError("Indexed image file no longer exists.")

    destination_folder.mkdir(parents=True, exist_ok=True)
    names = [_safe_filename(filename or source.name) for source, filename in files]
    occupied = {path.name for path in destination_folder.iterdir()}
    reserved: set[str] = set()
    destinations: list[Path] = []
    conflicts: list[dict[str, str]] = []
    for index, name in enumerate(names):
        if name in occupied or name in reserved:
            if conflict == "rename":
                name = _suggest_filename(destination_folder, name, occupied | reserved)
            else:
                conflicts.append(
                    {
                        "index": str(index),
                        "filename": name,
                        "suggested_filename": _suggest_filename(
                            destination_folder, name, occupied | reserved
                        ),
                    }
                )
        reserved.add(name)
        destinations.append(destination_folder / name)

    if conflicts:
        raise BatchFileConflictError(conflicts)

    staged: list[tuple[Path, Path]] = []
    committed: list[Path] = []
    removed_sources: list[tuple[Path, Path]] = []
    try:
        for (source, _), destination in zip(files, destinations):
            descriptor, temporary_name = tempfile.mkstemp(
                dir=destination_folder,
                prefix=f".{destination.name}.",
                suffix=".transfer",
            )
            os.close(descriptor)
            temporary = Path(temporary_name)
            staged.append((temporary, destination))
            shutil.copy2(source, temporary)

        for temporary, destination in staged:
            os.replace(temporary, destination)
            committed.append(destination)

        if mode == "move":
            for (source, _), destination in zip(files, destinations):
                source.unlink()
                removed_sources.append((source, destination))
    except Exception:
        for temporary, _ in staged:
            temporary.unlink(missing_ok=True)
        for source, destination in removed_sources:
            if destination.is_file():
                shutil.copy2(destination, source)
        for destination in committed:
            destination.unlink(missing_ok=True)
        raise
    return destinations


def _safe_filename(value: str) -> str:
    filename = Path(value).name
    if not filename or filename != value:
        raise ValueError("Transfer filename must not contain a path.")
    return filename


def _suggest_filename(
    destination_folder: Path, filename: str, occupied: set[str] | None = None
) -> str:
    path = Path(filename)
    occupied = occupied or set()
    index = 1
    while True:
        candidate = f"{path.stem}_{index}{path.suffix}"
        if candidate not in occupied and not (destination_folder / candidate).exists():
            return candidate
        index += 1
