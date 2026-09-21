import asyncio
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from image_shelf.thumbnails import ThumbnailService


class ThumbnailServiceTests(unittest.IsolatedAsyncioTestCase):
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


if __name__ == "__main__":
    unittest.main()
