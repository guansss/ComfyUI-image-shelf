from __future__ import annotations

import asyncio
import hashlib
import os
import tempfile
from pathlib import Path

from PIL import Image, ImageOps

from .paths import normalize_path


class ThumbnailService:
    VERSION = "v1"
    MAX_DIMENSION = 256
    QUALITY = 80
    MAX_PIXELS = 100_000_000

    def __init__(self, cache_root: str | Path) -> None:
        self.cache_root = normalize_path(cache_root)
        self._tasks: dict[str, asyncio.Task[Path]] = {}

    def cache_key(self, source: str | Path, source_id: str) -> str:
        source_path = normalize_path(source)
        stat = source_path.stat()
        identity = ":".join(
            (
                self.VERSION,
                source_id,
                str(source_path),
                str(stat.st_mtime_ns),
                str(stat.st_size),
                str(self.MAX_DIMENSION),
                str(self.QUALITY),
            )
        )
        return hashlib.sha256(identity.encode("utf-8")).hexdigest()

    def path_for_key(self, cache_key: str) -> Path:
        if len(cache_key) != 64 or any(
            character not in "0123456789abcdef" for character in cache_key
        ):
            raise ValueError("Invalid thumbnail cache key")
        return self.cache_root / self.VERSION / cache_key[:2] / f"{cache_key}.webp"

    async def get_or_create(
        self, source: str | Path, source_id: str, cache_key: str
    ) -> Path:
        expected_key = self.cache_key(source, source_id)
        if cache_key != expected_key:
            raise ValueError("Thumbnail cache key is stale")
        destination = self.path_for_key(cache_key)
        if destination.is_file():
            return destination

        task = self._tasks.get(cache_key)
        if task is None or task.done():
            task = asyncio.create_task(self._generate(source, destination))
            self._tasks[cache_key] = task
        try:
            return await task
        finally:
            if task.done() and self._tasks.get(cache_key) is task:
                self._tasks.pop(cache_key, None)

    async def close(self) -> None:
        tasks = tuple(task for task in self._tasks.values() if not task.done())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()

    async def _generate(self, source: str | Path, destination: Path) -> Path:
        return await asyncio.to_thread(self._generate_sync, Path(source), destination)

    def _generate_sync(self, source: Path, destination: Path) -> Path:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary_path: Path | None = None
        try:
            with Image.open(source) as image:
                if image.width * image.height > self.MAX_PIXELS:
                    raise ValueError("Image exceeds the thumbnail pixel limit")
                image = ImageOps.exif_transpose(image)
                image.thumbnail(
                    (self.MAX_DIMENSION, self.MAX_DIMENSION),
                    Image.Resampling.LANCZOS,
                )
                if image.mode not in ("RGB", "RGBA"):
                    image = image.convert("RGBA")
                file_descriptor, temporary_name = tempfile.mkstemp(
                    prefix=f".{destination.stem}.",
                    suffix=".tmp",
                    dir=destination.parent,
                )
                os.close(file_descriptor)
                temporary_path = Path(temporary_name)
                image.save(temporary_path, "WEBP", quality=self.QUALITY, method=4)
            os.replace(temporary_path, destination)
            temporary_path = None
            return destination
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
