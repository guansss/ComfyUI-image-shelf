import tempfile
import unittest
from pathlib import Path

from image_shelf.database import ImageRepository
from image_shelf.models import IndexedImage, TagSuggestion


class TagSuggestionTests(unittest.TestCase):
    def test_fuzzy_suggestions_include_tag_type_and_respect_folder_scope(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            images = root / "images"
            outside = root / "outside"
            images.mkdir()
            outside.mkdir()
            repository = ImageRepository(root / "index.sqlite")
            repository.upsert_image(
                IndexedImage(
                    images / "cat.png", 1, 1, 1, 1.0, 1.0, None, None,
                    ("orange cat",), ("blurry",)
                )
            )
            repository.upsert_image(
                IndexedImage(
                    outside / "dog.png", 1, 1, 1, 1.0, 1.0, None, None,
                    ("dog",), ()
                )
            )

            self.assertEqual(
                repository.suggest_tags([images], "blurry"),
                (TagSuggestion("blurry", "negative", 1),),
            )
            self.assertEqual(repository.suggest_tags([images], "dog"), ())
            self.assertEqual(
                repository.suggest_tags(None, "g"),
                (TagSuggestion("dog", "positive", 1), TagSuggestion("orange cat", "positive", 1),),
            )
            self.assertEqual(
                repository.suggest_tags([images], ""),
                (TagSuggestion("blurry", "negative", 1), TagSuggestion("orange cat", "positive", 1)),
            )
            repository.close()


if __name__ == "__main__":
    unittest.main()
