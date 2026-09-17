from __future__ import annotations

import asyncio
import io
import time
from dataclasses import dataclass
from os import stat_result
from pathlib import Path

from PIL import Image

from .database import ImageRepository
from .error import ERROR_INVALID_DIR, CustomError
from .log import debug_logger
from .metadata.metadata import get_image_metadata
from .models import IndexedImage
from .paths import normalize_path

SUPPORTED_EXTENSIONS = {".bmp", ".gif", ".jpeg", ".jpg", ".png", ".tiff", ".webp"}


@dataclass(frozen=True)
class IndexingResult:
    indexed: int
    skipped: int
    removed: int
    errors: int


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
        existing_states = (
            self.repository.image_states_in_folder(folder) if not force else {}
        )
        existing_paths = set(existing_states)

        if not folder.is_dir():
            for path in existing_paths:
                self.repository.delete_path(path)
            raise CustomError(ERROR_INVALID_DIR, f"Folder {folder} is not a directory.")

        start_time = time.perf_counter()
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
                stat = normalized_path.stat()
                existing_state = existing_states.get(normalized_path)
                if existing_state == (stat.st_mtime, stat.st_size):
                    skipped += 1
                    continue
                image = self._read_image(normalized_path, stat)
                pending_images.append(image)
                indexed += 1
            except (OSError, ValueError):
                errors += 1

        if pending_images:
            self.repository.upsert_images(pending_images)

        stale_paths = existing_paths - seen_paths
        for path in stale_paths:
            self.repository.delete_path(path)

        end_time = time.perf_counter()
        elapsed_time = end_time - start_time
        debug_logger.info(
            "Indexed folder %s: %d indexed, %d skipped, %d removed, %d errors in %.2f seconds",
            folder,
            indexed,
            skipped,
            len(stale_paths),
            errors,
            elapsed_time,
        )

        return IndexingResult(indexed, skipped, len(stale_paths), errors)

    def _read_image(self, path: Path, stat_result: stat_result) -> IndexedImage:
        with open(path, "rb") as f:
            file = f.read()
            with Image.open(io.BytesIO(file)) as image:
                width, height = image.size
                metadata = get_image_metadata(file, image)
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
