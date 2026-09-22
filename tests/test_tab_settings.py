import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from image_shelf.configuration import ShelfSettings, load_settings_path


class FolderSettingsTests(unittest.TestCase):
    def test_prompt_hints_are_validated_and_persisted(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            settings_file = Path(temporary_directory) / "settings.json"
            settings = ShelfSettings(Path(temporary_directory), settings_file)
            settings.load()

            settings.update(
                {
                    "prompt_hints": [
                        {
                            "id": "custom-text",
                            "class_type": "CustomPrompt",
                            "input_name": "prompt",
                            "kind": "text",
                            "role": "positive",
                            "ignore": False,
                            "unknown": True,
                        }
                    ]
                }
            )

            self.assertEqual(
                settings.as_dict()["prompt_hints"],
                [
                    {
                        "id": "custom-text",
                        "class_type": "CustomPrompt",
                        "kind": "text",
                        "input_name": "prompt",
                        "role": "positive",
                        "ignore": False,
                    }
                ],
            )
            self.assertEqual(settings.get_prompt_hints()[0].input_name, "prompt")

    def test_invalid_prompt_hints_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            settings_file = Path(temporary_directory) / "settings.json"
            settings = ShelfSettings(Path(temporary_directory), settings_file)
            settings.load()

            with self.assertRaises(ValueError):
                settings.update(
                    {
                        "prompt_hints": [
                            {
                                "id": "hint",
                                "class_type": "CustomPrompt",
                                "input_name": "",
                            }
                        ]
                    }
                )
    def test_loads_custom_folders_and_drops_unknown_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            output = root / "output"
            custom = root / "custom"
            settings_file = root / "settings.json"
            settings_file.write_text(
                json.dumps(
                    {
                        "custom_folders": [
                            {
                                "id": "folder-1",
                                "name": "Inspiration",
                                "path": str(custom),
                                "unknown": True,
                            }
                        ],
                        "unknown-setting": True,
                    }
                ),
                encoding="utf-8",
            )

            settings = ShelfSettings(output, settings_file)
            settings.load()

            self.assertEqual(
                [folder.id for folder in settings.get_folders()], ["outputs", "folder-1"]
            )
            self.assertNotIn("unknown-setting", settings.as_dict())
            self.assertNotIn(
                "unknown", settings.as_dict()["custom_folders"][0]
            )

    def test_update_merges_and_persists_validated_settings(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            settings_file = root / "settings.json"
            settings = ShelfSettings(root / "output", settings_file)
            settings.load()

            settings.update(
                {
                    "custom_folders": [
                        {"id": "folder-1", "name": "Custom", "path": str(root / "custom")}
                    ]
                }
            )

            self.assertEqual(
                [folder.id for folder in settings.get_folders()], ["outputs", "folder-1"]
            )
            self.assertEqual(
                json.loads(settings_file.read_text(encoding="utf-8")),
                {
                    "custom_folders": [
                        {"id": "folder-1", "name": "Custom", "path": str(root / "custom")}
                    ],
                        "prompt_hints": [],
                    "thumbnail_cache_max_bytes": 2 * 1024 * 1024 * 1024,
                },
            )

    def test_invalid_known_values_are_rejected_without_overwriting(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            settings_file = Path(temporary_directory) / "settings.json"
            original = '{"custom_folders": []}\n'
            settings_file.write_text(original, encoding="utf-8")
            settings = ShelfSettings(Path(temporary_directory), settings_file)
            settings.load()

            with self.assertRaises(ValueError):
                settings.update({"custom_folders": "invalid"})

            self.assertEqual(settings_file.read_text(encoding="utf-8"), original)

    def test_missing_file_uses_default_settings(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            settings = ShelfSettings(
                Path(temporary_directory), Path(temporary_directory) / "missing.json"
            )
            settings.load()

            self.assertEqual(
                settings.as_dict(),
                {
                    "custom_folders": [],
                    "prompt_hints": [],
                    "thumbnail_cache_max_bytes": 2 * 1024 * 1024 * 1024,
                },
            )

    def test_load_settings_path_reads_the_selected_env_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            settings_path = root / "custom-settings.json"
            env_file = root / ".env.test"
            env_file.write_text(
                f"IMAGE_SHELF_SETTINGS_PATH={settings_path}\n", encoding="utf-8"
            )

            with patch.dict(os.environ, {}, clear=True):
                self.assertEqual(load_settings_path(env_file), settings_path.resolve())

    def test_malformed_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            settings_file = Path(temporary_directory) / "settings.json"
            settings_file.write_text("not json", encoding="utf-8")
            settings = ShelfSettings(Path(temporary_directory), settings_file)

            with self.assertRaises(ValueError):
                settings.load()


if __name__ == "__main__":
    unittest.main()
