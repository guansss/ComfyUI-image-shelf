import asyncio
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from image_shelf.database import ImageRepository
from image_shelf.indexer import FolderIndexer
from image_shelf.models import IndexedImage


class FolderIndexerTests(unittest.TestCase):
    def test_indexes_only_files_directly_in_folder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            images = root / "images"
            nested = images / "nested"
            images.mkdir()
            nested.mkdir()
            direct_image = images / "direct.png"
            nested_image = nested / "nested.png"
            Image.new("RGB", (1, 1)).save(direct_image)
            Image.new("RGB", (1, 1)).save(nested_image)

            repository = ImageRepository(root / "index.sqlite")
            repository.upsert_image(
                IndexedImage(nested_image, 1, 1, 1, 1.0, 1.0, None, None, (), ())
            )
            result = asyncio.run(FolderIndexer(repository).index_folder(images))

            page = repository.list_images([images])
            self.assertEqual(result.indexed, 1)
            self.assertEqual(result.removed, 1)
            self.assertEqual(page.total, 1)
            self.assertEqual(page.items[0].filename, "direct.png")
            repository.close()


if __name__ == "__main__":
    unittest.main()
