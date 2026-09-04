import json
import tempfile
import unittest
from pathlib import Path

from image_shelf.configuration import ShelfSettings


class TabSettingsTests(unittest.IsolatedAsyncioTestCase):
    async def test_apply_settings_preserves_outputs_and_adds_configured_tabs(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            output = root / "output"
            favorites = root / "favorites"
            custom = root / "custom"

            settings = ShelfSettings(
                output_folder=output,
                comfy_settings_loader=lambda: {
                    "image-shelf.favorites-folder": str(favorites),
                    "image-shelf.custom-tabs": json.dumps(
                        [
                            {
                                "id": "custom-1",
                                "name": "Inspiration",
                                "folder": str(custom),
                            }
                        ]
                    ),
                },
            )
            settings.load_comfy_settings()
            tabs = settings.get_tabs()

            self.assertEqual(
                [tab.id for tab in tabs], ["outputs", "favorites", "custom-1"]
            )
            self.assertEqual(tabs[0].folders, (output.resolve(),))
            self.assertEqual(tabs[1].folders, (favorites.resolve(),))
            self.assertEqual(tabs[2].folders, (custom.resolve(),))


if __name__ == "__main__":
    unittest.main()
