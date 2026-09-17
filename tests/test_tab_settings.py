import json
import tempfile
import unittest
from pathlib import Path

from image_shelf.configuration import ShelfSettings


class FolderSettingsTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_folders_preserves_outputs_and_adds_configured_folders(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            output = root / "output"
            custom = root / "custom"

            settings = ShelfSettings(
                output_folder=output,
                comfy_settings_loader=lambda: {
                    "image-shelf.custom-folders": [
                        {
                            "id": "folder-1",
                            "name": "Inspiration",
                            "path": str(custom),
                        }
                    ],
                },
            )
            settings.load_comfy_settings()
            folders = settings.get_folders()

            self.assertEqual([folder.id for folder in folders], ["outputs", "folder-1"])
            self.assertEqual(folders[0].path, output.resolve())
            self.assertEqual(folders[1].path, custom.resolve())

    async def test_get_folders_ignores_custom_folders_without_paths(self) -> None:
        settings = ShelfSettings(
            output_folder=Path("output"),
            comfy_settings_loader=lambda: {
                "image-shelf.custom-folders": [
                    {"id": "missing-path", "name": "Missing"},
                    {"id": "empty-path", "name": "Empty", "path": "  "},
                ]
            },
        )
        settings.load_comfy_settings()

        self.assertEqual([folder.id for folder in settings.get_folders()], ["outputs"])


if __name__ == "__main__":
    unittest.main()
