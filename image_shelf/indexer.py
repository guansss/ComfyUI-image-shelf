from __future__ import annotations

import asyncio
import io
import time
from collections.abc import Callable
from dataclasses import dataclass
from os import stat_result
from pathlib import Path
from typing import TypeVar

from PIL import Image

from .database import ImageRepository
from .error import ERROR_INVALID_DIR, CustomError
from .log import debug_logger
from .metadata.metadata import get_image_metadata
from .models import IndexedImage
from .paths import normalize_path

SUPPORTED_EXTENSIONS = {".bmp", ".gif", ".jpeg", ".jpg", ".png", ".tiff", ".webp"}
T = TypeVar("T")


@dataclass(frozen=True)
class IndexingResult:
    indexed: int
    skipped: int
    removed: int
    errors: int


@dataclass
class _IndexingTimings:
    durations: dict[str, float]
    counts: dict[str, int]
    start_time: float

    def __init__(self) -> None:
        self.durations = {}
        self.counts = {}
        self.start_time = time.perf_counter()

    def measure(self, operation: str, action: Callable[[], T]) -> T:
        start_time = time.perf_counter()
        try:
            return action()
        finally:
            self.durations[operation] = self.durations.get(operation, 0.0) + (
                time.perf_counter() - start_time
            )
            self.counts[operation] = self.counts.get(operation, 0) + 1

    def format(self) -> str:
        return (
            ", ".join(
                f"{operation}={self.durations[operation] * 1000:.2f}ms/{self.counts[operation]}"
                for operation in self.durations
            )
            + f", total={time.perf_counter() - self.start_time:.2f}s"
        )


class FolderIndexer:
    def __init__(
        self,
        repository: ImageRepository,
    ) -> None:
        self.repository = repository
        self._folder_locks: dict[Path, asyncio.Lock] = {}

    async def index_folder(
        self, folder: str | Path, force: bool = False
    ) -> IndexingResult:
        normalized_folder = normalize_path(folder)
        lock = self._folder_locks.setdefault(normalized_folder, asyncio.Lock())
        async with lock:
            return await asyncio.to_thread(self._index_folder, normalized_folder, force)

    def _index_folder(self, folder: Path, force: bool = False) -> IndexingResult:
        timings = _IndexingTimings()
        existing_states = (
            timings.measure(
                "database_lookup",
                lambda: self.repository.image_states_in_folder(folder),
            )
            if not force
            else {}
        )
        existing_paths = set(existing_states)

        if not folder.is_dir():
            for path in existing_paths:
                timings.measure(
                    "database_delete",
                    lambda path=path: self.repository.delete_path(path),
                )
            raise CustomError(ERROR_INVALID_DIR, f"Folder {folder} is not a directory.")

        seen_paths: set[Path] = set()
        indexed = 0
        skipped = 0
        errors = 0
        pending_images: list[IndexedImage] = []

        for path in folder.iterdir():
            if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue
            normalized_path = normalize_path(path)
            seen_paths.add(normalized_path)
            try:
                stat = timings.measure("file_stat", normalized_path.stat)
                existing_state = existing_states.get(normalized_path)
                if existing_state == (stat.st_mtime, stat.st_size):
                    skipped += 1
                    continue
                image = self._read_image(normalized_path, stat, timings)
                pending_images.append(image)
                indexed += 1
            except (OSError, ValueError):
                errors += 1

        if pending_images:
            timings.measure(
                "database_upsert", lambda: self.repository.upsert_images(pending_images)
            )

        stale_paths = existing_paths - seen_paths
        for path in stale_paths:
            timings.measure(
                "database_delete", lambda path=path: self.repository.delete_path(path)
            )

        debug_logger.info(
            "Indexed folder %s: %d indexed, %d skipped, %d removed, %d errors; %s",
            folder,
            indexed,
            skipped,
            len(stale_paths),
            errors,
            timings.format(),
        )

        return IndexingResult(indexed, skipped, len(stale_paths), errors)

    def _read_image(
        self, path: Path, stat_result: stat_result, timings: _IndexingTimings
    ) -> IndexedImage:
        with open(path, "rb") as file_handle:
            file = timings.measure("file_read", file_handle.read)
            with Image.open(io.BytesIO(file)) as image:
                width, height = image.size
                metadata = timings.measure(
                    "metadata_parse", lambda: get_image_metadata(file, image)
                )
        return IndexedImage(
            path=path,
            width=width,
            height=height,
            file_size=stat_result.st_size,
            created_at=stat_result.st_ctime,
            mtime=stat_result.st_mtime,
            workflow=metadata.normalized_info,
            parse_error=metadata.parse_error,
            tags=metadata.tags,
            negative_tags=metadata.negative_tags,
        )
