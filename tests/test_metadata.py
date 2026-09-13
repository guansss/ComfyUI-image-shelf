import json
import unittest
from pathlib import Path

from PIL import Image

from image_shelf.metadata import _parse_workflow, get_image_workflow

ASSETS = Path(__file__).parent / "assets"


class MetadataParsingTests(unittest.TestCase):
    def test_parses_api_workflow_prompts(self) -> None:
        with open(ASSETS / "api-workflow.json", encoding="utf-8") as workflow_file:
            result = _parse_workflow(json.dumps(json.load(workflow_file)))

        self.assertIsNone(result.parse_error)
        self.assertEqual(result.tags, ("best quality",))
        self.assertEqual(result.negative_tags, ("lowres",))

    def test_parses_a1111_metadata_from_jpeg_fixture(self) -> None:
        with open(ASSETS / "a1111.jpg", "rb") as image:
            result = get_image_workflow(image.read())

        self.assertIsNone(result.parse_error)
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
        self.assertIn("Steps: 25", result.workflow or "")

    def test_parses_a1111_metadata_from_png_fixture(self) -> None:
        with open(ASSETS / "a1111.png", "rb") as image:
            result = get_image_workflow(image.read())

        self.assertIsNone(result.parse_error)
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
        self.assertIn("Steps: 25", result.workflow or "")


if __name__ == "__main__":
    unittest.main()
