import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from image_shelf.api import create_gallery_app


class TabSettingsTests(unittest.IsolatedAsyncioTestCase):
    async def test_apply_settings_preserves_outputs_and_adds_configured_tabs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            output = root / "output"
            favorites = root / "favorites"
            custom = root / "custom"
            for folder in (output, favorites, custom):
                folder.mkdir()

            app = create_gallery_app(root / "index.sqlite", [output])
            api = app["image_shelf_api"]
            await api.apply_settings(
                {
                    "image-shelf.favorites-folder": str(favorites),
                    "image-shelf.custom-tabs": json.dumps(
                        [{"id": "custom-1", "name": "Inspiration", "folder": str(custom)}]
                    ),
                }
            )

            self.assertEqual([tab.id for tab in api.tabs], ["outputs", "favorites", "custom-1"])
            self.assertEqual(api.tabs[0].folders, (output.resolve(),))
            self.assertEqual(api.tabs[1].folders, (favorites.resolve(),))
            self.assertEqual(api.tabs[2].folders, (custom.resolve(),))

            for task in api.indexing_tasks.values():
                await task
            api.stop_monitoring()
            api.repository.close()


if __name__ == "__main__":
    unittest.main()