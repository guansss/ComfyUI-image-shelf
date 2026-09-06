import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from image_shelf.database import ImageRepository
from image_shelf.indexer import FolderIndexer
from image_shelf.models import IndexedImage


class FolderIndexerTests(unittest.TestCase):
    def test_bulk_upsert_rejects_more_columns_than_configured(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            repository = ImageRepository(root / "index.sqlite")
            image = IndexedImage(
                root / "image.png", 1, 1, 1, 1.0, 1.0, None, None, (), ()
            )

            with patch("image_shelf.database._IMAGE_COLUMNS", 10):
                with self.assertRaisesRegex(RuntimeError, "maximum supported is 10"):
                    repository._upsert_image_rows(
                        ((image.path, image), (image.path, image))
                    )
            repository.close()

    def test_bulk_upsert_returns_ids_for_inserts_and_conflicts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            repository = ImageRepository(root / "index.sqlite")
            images = tuple(
                IndexedImage(
                    root / f"image-{index}.png",
                    1,
                    1,
                    1,
                    1.0,
                    1.0,
                    None,
                    None,
                    (),
                    (),
                )
                for index in range(81)
            )

            first_ids = repository.upsert_images(images)
            second_ids = repository.upsert_images(
                IndexedImage(
                    image.path,
                    2,
                    image.height,
                    image.file_size,
                    image.created_at,
                    image.mtime,
                    image.workflow,
                    image.parse_error,
                    image.tags,
                    image.negative_tags,
                )
                for image in images
            )

            self.assertEqual(len(first_ids), 81)
            self.assertEqual(first_ids, second_ids)
            self.assertEqual(repository.list_images([root]).total, 81)
            repository.close()

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
            self.assertEqual(result.removed, 0)
            self.assertEqual(page.total, 2)
            self.assertEqual(
                {item.filename for item in page.items}, {"direct.png", "nested.png"}
            )
            repository.close()


if __name__ == "__main__":
    unittest.main()
