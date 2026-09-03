from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from .database import ImageRepository
from .metadata import parse_image_workflow
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
    def __init__(self, repository: ImageRepository) -> None:
        self.repository = repository
        self._folder_locks: dict[Path, asyncio.Lock] = {}

    async def index_folder(self, folder: str | Path) -> IndexingResult:
        normalized_folder = normalize_path(folder)
        lock = self._folder_locks.setdefault(normalized_folder, asyncio.Lock())
        async with lock:
            return await asyncio.to_thread(self._index_folder, normalized_folder)

    def _index_folder(self, folder: Path) -> IndexingResult:
        if not folder.is_dir():
            return IndexingResult(indexed=0, skipped=0, removed=0, errors=1)

        seen_paths: set[Path] = set()
        indexed = 0
        skipped = 0
        errors = 0
        for path in folder.iterdir():
            if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue
            normalized_path = normalize_path(path)
            seen_paths.add(normalized_path)
            try:
                stat = normalized_path.stat()
                if self.repository.image_is_current(
                    normalized_path, stat.st_mtime, stat.st_size
                ):
                    skipped += 1
                    continue
                image = self._read_image(normalized_path, stat)
                self.repository.upsert_image(image)
                indexed += 1
            except (OSError, ValueError):
                errors += 1

        stale_paths = self.repository.paths_in_folder(folder) - seen_paths
        for path in stale_paths:
            self.repository.delete_path(path)
        return IndexingResult(indexed, skipped, len(stale_paths), errors)

    def _read_image(self, path: Path, stat_result: object) -> IndexedImage:
        with Image.open(path) as image:
            width, height = image.size
        parsed_workflow = parse_image_workflow(path)
        return IndexedImage(
            path=path,
            width=width,
            height=height,
            file_size=stat_result.st_size,
            created_at=stat_result.st_ctime,
            mtime=stat_result.st_mtime,
            workflow=parsed_workflow.workflow,
            parse_error=parsed_workflow.parse_error,
            tags=parsed_workflow.tags,
            negative_tags=parsed_workflow.negative_tags,
        )
