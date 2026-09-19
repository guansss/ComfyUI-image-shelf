import tempfile
import unittest
from pathlib import Path

from image_shelf.transfer import FileConflictError, transfer_file


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


if __name__ == "__main__":
    unittest.main()
