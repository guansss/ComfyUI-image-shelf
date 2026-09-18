import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from image_shelf.database import ImageRepository
from image_shelf.indexer import FolderIndexer
from image_shelf.models import IndexedImage
from image_shelf.search import SearchTerm


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

    def test_tag_upsert_batches_and_replaces_links(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            repository = ImageRepository(root / "index.sqlite")
            first_image = IndexedImage(
                root / "first.png",
                1,
                1,
                1,
                1.0,
                1.0,
                None,
                None,
                ("Cat", "cat", "Dog"),
                ("CAT",),
            )
            second_image = IndexedImage(
                root / "second.png",
                1,
                1,
                1,
                1.0,
                1.0,
                None,
                None,
                ("Bird",),
                (),
            )

            with patch.object(repository, "_parameter_limit", return_value=2):
                repository.upsert_images((first_image, second_image))

            public_id = repository.connection.execute(
                "SELECT public_id FROM images WHERE path = ?", (str(first_image.path),)
            ).fetchone()[0]
            details = repository.image_details(public_id)
            self.assertIsNotNone(details)
            first_details, _ = details
            self.assertEqual(first_details.tags, ("Cat", "Dog"))
            self.assertEqual(first_details.negative_tags, ("CAT",))

            repository.upsert_image(
                IndexedImage(
                    first_image.path,
                    1,
                    1,
                    1,
                    1.0,
                    1.0,
                    None,
                    None,
                    ("Fox",),
                    (),
                )
            )
            details = repository.image_details(public_id)
            self.assertIsNotNone(details)
            first_details, _ = details
            self.assertEqual(first_details.tags, ("Fox",))
            self.assertEqual(first_details.negative_tags, ())

            tag_rows = repository.connection.execute(
                "SELECT name, type FROM tags ORDER BY type, name"
            ).fetchall()
            self.assertEqual(
                [(row["name"], row["type"]) for row in tag_rows],
                [
                    ("CAT", "negative"),
                    ("Bird", "positive"),
                    ("Cat", "positive"),
                    ("Dog", "positive"),
                    ("Fox", "positive"),
                ],
            )
            repository.close()

    def test_deleting_images_removes_images(self) -> None:
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
                    "workflow",
                    None,
                    (f"tag-{index}",),
                    (),
                )
                for index in range(2)
            )
            repository.upsert_images(images)

            repository.delete_path(images[0].path)
            self.assertEqual(
                repository.connection.execute(
                    "SELECT COUNT(*) FROM images"
                ).fetchone()[0],
                1,
            )

            repository.delete_untracked_paths((root / "other",))
            self.assertEqual(
                repository.connection.execute(
                    "SELECT COUNT(*) FROM images"
                ).fetchone()[0],
                0,
            )
            repository.close()

    def test_identical_workflows_are_stored_and_indexed_once(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            repository = ImageRepository(root / "index.sqlite")
            workflow = '{"nodes": [{"class_type": "KSampler"}]}'
            images = tuple(
                IndexedImage(
                    root / f"image-{index}.png",
                    1,
                    1,
                    1,
                    1.0,
                    1.0,
                    workflow,
                    None,
                    (),
                    (),
                )
                for index in range(2)
            )
            repository.upsert_images(images)

            self.assertEqual(
                repository.connection.execute(
                    "SELECT COUNT(*) FROM workflows"
                ).fetchone()[0],
                1,
            )
            self.assertEqual(
                repository.list_images(
                    [root], (SearchTerm("prompt", "KSampler"),)
                ).total,
                2,
            )
            repository.close()

    def test_workflows_are_upserted_in_batches(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            repository = ImageRepository(root / "index.sqlite")
            repository._workflow_insert_batch_size = 2
            images = tuple(
                IndexedImage(
                    root / f"image-{index}.png",
                    1,
                    1,
                    1,
                    1.0,
                    1.0,
                    f'{{"workflow": {index}}}',
                    None,
                    (),
                    (),
                )
                for index in range(3)
            )

            repository.upsert_images(images)

            self.assertEqual(
                repository.connection.execute(
                    "SELECT COUNT(*) FROM workflows"
                ).fetchone()[0],
                3,
            )
            self.assertEqual(repository.list_images([root]).total, 3)
            repository.close()

    def test_workflow_upsert_rejects_more_columns_than_configured(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            repository = ImageRepository(root / "index.sqlite")

            with patch("image_shelf.database._WORKFLOW_COLUMNS", 0):
                with self.assertRaisesRegex(RuntimeError, "maximum supported is 0"):
                    repository._upsert_workflows(
                        (
                            IndexedImage(
                                root / "image.png",
                                1,
                                1,
                                1,
                                1.0,
                                1.0,
                                "workflow",
                                None,
                                (),
                                (),
                            ),
                        )
                    )
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

    def test_force_reindexes_unchanged_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            image_path = root / "image.png"
            Image.new("RGB", (1, 1)).save(image_path)

            repository = ImageRepository(root / "index.sqlite")
            indexer = FolderIndexer(repository)
            asyncio.run(indexer.index_folder(root))

            result = asyncio.run(indexer.index_folder(root, force=True))

            self.assertEqual(result.indexed, 1)
            self.assertEqual(result.skipped, 0)
            repository.close()


if __name__ == "__main__":
    unittest.main()
