from __future__ import annotations

import asyncio
import hashlib
import os
import tempfile
import time
from collections.abc import Awaitable, Callable
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
    DEFAULT_MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024
    MAINTENANCE_INTERVAL = 60.0
    TEMPORARY_FILE_GRACE_PERIOD = 3600.0

    def __init__(
        self,
        cache_root: str | Path,
        max_cache_bytes: int = DEFAULT_MAX_CACHE_BYTES,
    ) -> None:
        self.cache_root = normalize_path(cache_root)
        self.max_cache_bytes = self._validate_max_cache_bytes(max_cache_bytes)
        self._tasks: dict[str, asyncio.Task[Path]] = {}
        self._queue: asyncio.PriorityQueue[
            tuple[int, int, int, str, Path, str]
        ] = asyncio.PriorityQueue()
        self._queued_keys: set[str] = set()
        self._workers: list[asyncio.Task[None]] = []
        self._sequence = 0
        self._generation = 0
        self._failures: dict[str, tuple[float, float, BaseException]] = {}
        self._maintenance_task: asyncio.Task[None] | None = None
        self._maintenance_steps: list[Callable[[], Awaitable[None]]] = [
            self.cleanup_stale_files,
            self.enforce_cache_limit
        ]

    async def start(self) -> None:
        if self._workers:
            return
        self._workers = [
            asyncio.create_task(self._worker()) for _ in range(self.WORKER_COUNT)
        ]
        self._maintenance_task = asyncio.create_task(self._maintenance_worker())

    def set_max_cache_bytes(self, value: int) -> None:
        self.max_cache_bytes = self._validate_max_cache_bytes(value)

    def add_maintenance_step(self, step: Callable[[], Awaitable[None]]) -> None:
        self._maintenance_steps.append(step)

    async def cache_statistics(self) -> dict[str, int]:
        return await asyncio.to_thread(self._cache_statistics_sync)

    async def clear_cache(self) -> None:
        await asyncio.to_thread(self._clear_cache_sync)
        self._failures.clear()

    async def enforce_cache_limit(self) -> None:
        await asyncio.to_thread(self._enforce_cache_limit_sync)

    async def cleanup_stale_files(self) -> None:
        await asyncio.to_thread(self._cleanup_stale_files_sync)

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
            self._touch(destination)
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
        maintenance_task = self._maintenance_task
        self._maintenance_task = None
        for task in (*tasks, *workers, maintenance_task):
            if task is not None:
                task.cancel()
        if tasks or workers or maintenance_task:
            await asyncio.gather(
                *tasks,
                *workers,
                *(task for task in (maintenance_task,) if task is not None),
                return_exceptions=True,
            )
        self._tasks.clear()
        self._workers.clear()
        self._queued_keys.clear()
        while not self._queue.empty():
            self._queue.get_nowait()

    async def _maintenance_worker(self) -> None:
        while True:
            await asyncio.sleep(self.MAINTENANCE_INTERVAL)
            for step in tuple(self._maintenance_steps):
                try:
                    await step()
                except asyncio.CancelledError:
                    raise
                except Exception:
                    continue

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
            self._touch(destination)
            temporary_path = None
            return destination
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    @classmethod
    def _validate_max_cache_bytes(cls, value: int) -> int:
        if not isinstance(value, int) or value <= 0:
            raise ValueError("Thumbnail cache size must be a positive integer")
        return value

    def _cache_files(self) -> list[Path]:
        version_root = self.cache_root / self.VERSION
        if not version_root.is_dir():
            return []
        return [
            path
            for path in version_root.rglob("*.webp")
            if path.is_file() and len(path.stem) == 64
        ]

    def _cache_statistics_sync(self) -> dict[str, int]:
        files = self._cache_files()
        total_bytes = 0
        valid_files = 0
        for path in files:
            try:
                total_bytes += path.stat().st_size
                valid_files += 1
            except OSError:
                continue
        return {
            "bytes": total_bytes,
            "files": valid_files,
            "max_bytes": self.max_cache_bytes,
        }

    def _enforce_cache_limit_sync(self) -> None:
        files: list[tuple[float, int, Path]] = []
        total_bytes = 0
        for path in self._cache_files():
            try:
                stat = path.stat()
            except OSError:
                continue
            total_bytes += stat.st_size
            files.append((stat.st_atime_ns or stat.st_mtime_ns, stat.st_size, path))
        if total_bytes <= self.max_cache_bytes:
            return
        for _, size, path in sorted(files):
            if total_bytes <= self.max_cache_bytes:
                break
            try:
                path.unlink()
            except OSError:
                continue
            total_bytes -= size

    def _clear_cache_sync(self) -> None:
        if not self.cache_root.is_dir():
            return
        for path in self.cache_root.rglob("*"):
            if path.is_file():
                try:
                    path.unlink()
                except OSError:
                    continue

    def _cleanup_stale_files_sync(self) -> None:
        cutoff = time.time() - self.TEMPORARY_FILE_GRACE_PERIOD
        if not self.cache_root.is_dir():
            return
        active_root = self.cache_root / self.VERSION
        for path in self.cache_root.rglob("*"):
            try:
                if (
                    path.is_file()
                    and path.stat().st_mtime < cutoff
                    and (path.name.startswith(".") or not path.is_relative_to(active_root))
                ):
                    path.unlink()
            except OSError:
                continue

    @staticmethod
    def _touch(path: Path) -> None:
        try:
            current_time = time.time_ns()
            os.utime(path, ns=(current_time, current_time))
        except OSError:
            pass
