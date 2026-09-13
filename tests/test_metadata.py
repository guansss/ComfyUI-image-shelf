import json
import unittest
from pathlib import Path

from image_shelf.metadata.metadata import get_image_metadata, parse_metadata

ASSETS = Path(__file__).parent / "assets"


class MetadataParsingTests(unittest.TestCase):
    def test_parses_api_workflow_prompts(self) -> None:
        with open(ASSETS / "api-workflow.json", encoding="utf-8") as workflow_file:
            result = parse_metadata({"prompt": json.load(workflow_file)})

        self.assertIsNone(result.parse_error)
        self.assertEqual(result.type, "comfy")
        self.assertEqual(result.tags, ("best quality",))
        self.assertEqual(result.negative_tags, ("lowres",))

    def test_parses_a1111_metadata_from_jpeg_fixture(self) -> None:
        with open(ASSETS / "a1111.jpg", "rb") as image:
            result = get_image_metadata(image.read())

        self.assertIsNone(result.parse_error)
        self.assertEqual(result.type, "a1111")
        self.assertEqual(
            result.tags,
            (
                "masterpiece",
                r"amiya_\(arknights\)",
                "light smile",
                "cityscape",
                "<lora:amiya_(arknights)-000008:0.9>",
            ),
        )
        self.assertEqual(result.negative_tags, ("lowres",))
        self.assertIn("Steps: 25", result.info or "")

    def test_parses_a1111_metadata_from_png_fixture(self) -> None:
        with open(ASSETS / "a1111.png", "rb") as image:
            result = get_image_metadata(image.read())

        self.assertIsNone(result.parse_error)
        self.assertEqual(result.type, "a1111")
        self.assertEqual(
            result.tags,
            (
                "masterpiece",
                r"amiya_\(arknights\)",
                "light smile",
                "cityscape",
                "<lora:amiya_(arknights)-000008:0.9>",
            ),
        )
        self.assertEqual(result.negative_tags, ("lowres",))
        self.assertIn("Steps: 25", result.info or "")


if __name__ == "__main__":
    unittest.main()
