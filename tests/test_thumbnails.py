import asyncio
import os
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from image_shelf.thumbnails import ThumbnailService


class ThumbnailServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_background_workers_are_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "source.png"
            Image.new("RGB", (20, 20), "red").save(source)
            service = ThumbnailService(root / "thumbnails")
            active = 0
            maximum_active = 0
            completed = 0

            async def generate(source_path: str | Path, destination: Path) -> Path:
                nonlocal active, completed, maximum_active
                active += 1
                maximum_active = max(maximum_active, active)
                await asyncio.sleep(0.01)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.touch()
                active -= 1
                completed += 1
                return destination

            service._generate = generate  # type: ignore[method-assign]
            generation = service.new_generation()
            for index in range(5):
                cache_key = service.cache_key(source, f"image-{index}")
                service.schedule(source, f"image-{index}", cache_key, generation=generation)
            await service.start()

            while completed < 5:
                await asyncio.sleep(0.01)
            await service.close()

            self.assertLessEqual(maximum_active, service.WORKER_COUNT)

    async def test_new_generation_skips_stale_queued_work(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "source.png"
            Image.new("RGB", (20, 20), "red").save(source)
            service = ThumbnailService(root / "thumbnails")
            generated: list[str] = []

            async def generate(source_path: str | Path, destination: Path) -> Path:
                generated.append(destination.name)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.touch()
                return destination

            service._generate = generate  # type: ignore[method-assign]
            stale_generation = service.new_generation()
            stale_key = service.cache_key(source, "stale")
            service.schedule(source, "stale", stale_key, generation=stale_generation)
            current_generation = service.new_generation()
            current_key = service.cache_key(source, "current")
            service.schedule(source, "current", current_key, generation=current_generation)
            await service.start()

            while not generated:
                await asyncio.sleep(0.01)
            await service.close()

            self.assertEqual(generated, [f"{current_key}.webp"])

    async def test_generates_webp_with_preserved_aspect_ratio_and_reuses_cache(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "source.png"
            cache = root / "thumbnails"
            Image.new("RGB", (800, 400), "red").save(source)
            service = ThumbnailService(cache)

            cache_key = service.cache_key(source, "image-id")
            first = await service.get_or_create(source, "image-id", cache_key)
            second = await service.get_or_create(source, "image-id", cache_key)

            self.assertEqual(first, second)
            self.assertEqual(first.suffix, ".webp")
            self.assertTrue(first.is_file())
            with Image.open(first) as thumbnail:
                self.assertEqual(thumbnail.size, (256, 128))

    async def test_source_changes_produce_a_new_cache_key(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "source.png"
            Image.new("RGB", (10, 10), "red").save(source)
            service = ThumbnailService(root / "thumbnails")
            first_key = service.cache_key(source, "image-id")

            Image.new("RGB", (20, 10), "blue").save(source)

            self.assertNotEqual(first_key, service.cache_key(source, "image-id"))

    async def test_concurrent_requests_share_generation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "source.png"
            Image.new("RGB", (20, 20), "red").save(source)
            service = ThumbnailService(root / "thumbnails")
            cache_key = service.cache_key(source, "image-id")
            original_generate = service._generate
            calls = 0

            async def generate(source_path: str | Path, destination: Path) -> Path:
                nonlocal calls
                calls += 1
                await asyncio.sleep(0)
                return await original_generate(source_path, destination)

            service._generate = generate  # type: ignore[method-assign]
            results = await asyncio.gather(
                service.get_or_create(source, "image-id", cache_key),
                service.get_or_create(source, "image-id", cache_key),
            )

            self.assertEqual(calls, 1)
            self.assertEqual(results[0], results[1])

    async def test_rejects_stale_cache_key(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "source.png"
            Image.new("RGB", (10, 10)).save(source)
            service = ThumbnailService(root / "thumbnails")

            with self.assertRaisesRegex(ValueError, "stale"):
                await service.get_or_create(source, "image-id", "0" * 64)

    async def test_enforces_cache_limit_using_least_recently_used_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            service = ThumbnailService(root / "thumbnails", max_cache_bytes=5)
            oldest = service.path_for_key("a" * 64)
            newest = service.path_for_key("b" * 64)
            oldest.parent.mkdir(parents=True)
            oldest.write_bytes(b"old")
            newest.parent.mkdir(parents=True)
            newest.write_bytes(b"new")
            os.utime(oldest, ns=(1, 1))
            os.utime(newest, ns=(2, 2))

            await service.enforce_cache_limit()

            self.assertFalse(oldest.exists())
            self.assertTrue(newest.exists())
            self.assertEqual(
                await service.cache_statistics(),
                {"bytes": 3, "files": 1, "max_bytes": 5},
            )

    async def test_clear_cache_removes_only_cache_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "source.png"
            source.write_bytes(b"source")
            service = ThumbnailService(root / "thumbnails")
            cache_file = service.path_for_key("a" * 64)
            cache_file.parent.mkdir(parents=True)
            cache_file.write_bytes(b"thumbnail")

            await service.clear_cache()

            self.assertFalse(cache_file.exists())
            self.assertEqual(source.read_bytes(), b"source")

    async def test_maintenance_worker_runs_registered_steps(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            service = ThumbnailService(Path(temporary_directory) / "thumbnails")
            service.MAINTENANCE_INTERVAL = 0.01
            completed = asyncio.Event()

            async def maintenance_step() -> None:
                completed.set()

            service.add_maintenance_step(maintenance_step)
            await service.start()
            await asyncio.wait_for(completed.wait(), timeout=1)
            await service.close()


if __name__ == "__main__":
    unittest.main()
