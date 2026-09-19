import tempfile
import unittest
from pathlib import Path

from image_shelf.transfer import (
    BatchFileConflictError,
    FileConflictError,
    transfer_file,
    transfer_files,
)


class FavoritesTransferTests(unittest.TestCase):
    def test_copy_conflict_and_move(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "source.png"
            favorites = root / "favorites"
            source.write_bytes(b"image")

            copied = transfer_file(source, favorites, "copy")
            self.assertEqual(copied.read_bytes(), b"image")
            self.assertTrue(source.exists())

            with self.assertRaises(FileConflictError) as context:
                transfer_file(source, favorites, "copy")
            self.assertEqual(context.exception.suggested_name, "source_1.png")

            moved = transfer_file(source, favorites, "move", "moved.png")
            self.assertTrue(moved.is_file())
            self.assertFalse(source.exists())

    def test_batch_rename_transfers_all_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source_one = root / "one.png"
            source_two = root / "two.png"
            destination_folder = root / "favorites"
            source_one.write_bytes(b"one")
            source_two.write_bytes(b"two")
            destination_folder.mkdir()
            (destination_folder / "one.png").write_bytes(b"old")

            destinations = transfer_files(
                [(source_one, None), (source_two, "one.png")],
                destination_folder,
                "copy",
                conflict="rename",
            )

            self.assertEqual([path.name for path in destinations], ["one_1.png", "one_2.png"])
            self.assertEqual((destination_folder / "one_1.png").read_bytes(), b"one")
            self.assertEqual((destination_folder / "one_2.png").read_bytes(), b"two")
            self.assertTrue(source_one.exists())
            self.assertTrue(source_two.exists())

    def test_batch_suggest_reports_all_conflicts_without_transferring(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source_one = root / "one.png"
            source_two = root / "two.png"
            destination_folder = root / "favorites"
            source_one.write_bytes(b"one")
            source_two.write_bytes(b"two")
            destination_folder.mkdir()
            (destination_folder / "one.png").write_bytes(b"old one")
            (destination_folder / "two.png").write_bytes(b"old two")

            with self.assertRaises(BatchFileConflictError) as context:
                transfer_files(
                    [(source_one, None), (source_two, None)],
                    destination_folder,
                    "move",
                    conflict="suggest",
                )

            self.assertEqual(
                context.exception.conflicts,
                [
                    {
                        "index": "0",
                        "filename": "one.png",
                        "suggested_filename": "one_1.png",
                    },
                    {
                        "index": "1",
                        "filename": "two.png",
                        "suggested_filename": "two_1.png",
                    },
                ],
            )
            self.assertTrue(source_one.exists())
            self.assertTrue(source_two.exists())
            self.assertEqual((destination_folder / "one.png").read_bytes(), b"old one")


if __name__ == "__main__":
    unittest.main()
