from __future__ import annotations

import asyncio
import hashlib
import os
import tempfile
import time
from pathlib import Path

from PIL import Image, ImageOps

from .paths import normalize_path


class ThumbnailService:
    VERSION = "v1"
    MAX_DIMENSION = 256
    QUALITY = 80
    MAX_PIXELS = 100_000_000
    WORKER_COUNT = 2
    RETRY_BASE_DELAY = 1.0
    RETRY_MAX_DELAY = 60.0

    def __init__(self, cache_root: str | Path) -> None:
        self.cache_root = normalize_path(cache_root)
        self._tasks: dict[str, asyncio.Task[Path]] = {}
        self._queue: asyncio.PriorityQueue[
            tuple[int, int, int, str, Path, str]
        ] = asyncio.PriorityQueue()
        self._queued_keys: set[str] = set()
        self._workers: list[asyncio.Task[None]] = []
        self._sequence = 0
        self._generation = 0
        self._failures: dict[str, tuple[float, float, BaseException]] = {}

    async def start(self) -> None:
        if self._workers:
            return
        self._workers = [
            asyncio.create_task(self._worker()) for _ in range(self.WORKER_COUNT)
        ]

    def new_generation(self) -> int:
        self._generation += 1
        return self._generation

    def is_current_generation(self, generation: int) -> bool:
        return generation == self._generation

    def schedule(
        self,
        source: str | Path,
        source_id: str,
        cache_key: str,
        *,
        priority: int = 0,
        generation: int | None = None,
    ) -> None:
        if generation is None:
            generation = self._generation
        if cache_key in self._queued_keys or cache_key in self._tasks:
            return
        try:
            destination = self.path_for_key(cache_key)
        except ValueError:
            return
        if destination.is_file() or self._failure_is_active(cache_key):
            return
        self._sequence += 1
        self._queued_keys.add(cache_key)
        self._queue.put_nowait(
            (priority, self._sequence, generation, cache_key, Path(source), source_id)
        )

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
                if not task.cancelled() and task.exception() is None:
                    self._failures.pop(cache_key, None)

    async def close(self) -> None:
        tasks = tuple(task for task in self._tasks.values() if not task.done())
        workers = tuple(self._workers)
        for task in (*tasks, *workers):
            task.cancel()
        if tasks or workers:
            await asyncio.gather(*tasks, *workers, return_exceptions=True)
        self._tasks.clear()
        self._workers.clear()
        self._queued_keys.clear()
        while not self._queue.empty():
            self._queue.get_nowait()

    async def _worker(self) -> None:
        while True:
            _, _, generation, cache_key, source, source_id = await self._queue.get()
            self._queued_keys.discard(cache_key)
            if generation != self._generation:
                continue
            try:
                await self.get_or_create(source, source_id, cache_key)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self._record_failure(cache_key, error)

    def _failure_is_active(self, cache_key: str) -> bool:
        failure = self._failures.get(cache_key)
        return failure is not None and time.monotonic() < failure[0] + failure[1]

    def _record_failure(self, cache_key: str, error: BaseException) -> None:
        previous = self._failures.get(cache_key)
        delay = self.RETRY_BASE_DELAY
        if previous is not None:
            delay = min(previous[1] * 2, self.RETRY_MAX_DELAY)
        self._failures[cache_key] = (time.monotonic(), delay, error)

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
