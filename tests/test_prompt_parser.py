import json
import unittest
from pathlib import Path

from image_shelf.prompt_parser import PromptHint, parse_workflow
from image_shelf.prompt_parser.graph import APIWorkflowGraph

ASSETS = Path(__file__).parent / "assets"


class PromptParserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with (
            open(ASSETS / "api-workflow.json", encoding="utf-8") as api_workflow_file,
            open(ASSETS / "ui-workflow.json", encoding="utf-8") as ui_workflow_file,
        ):
            cls.api_workflow = json.load(api_workflow_file)
            cls.ui_workflow = json.load(ui_workflow_file)

    def test_extracts_positive_and_negative_prompts_from_api_workflow(self) -> None:
        result = parse_workflow(self.api_workflow, self.ui_workflow)
        matches = {(match.text, match.role) for match in result.matches}
        self.assertIn(("best quality", "positive"), matches)
        self.assertIn(("lowres", "negative"), matches)
        self.assertNotIn(("951432413360540", "unknown"), matches)

    def test_preserves_paths_and_colon_node_ids(self) -> None:
        result = parse_workflow(self.api_workflow, self.ui_workflow)
        positive = next(
            match for match in result.matches if match.text == "best quality"
        )
        self.assertEqual(positive.node_id, "16")
        self.assertTrue(any(step.node_id == "12:3" for step in positive.path))
        graph = APIWorkflowGraph.from_api_workflow(self.api_workflow)
        self.assertEqual(graph.require_node("12:13:5").class_type, "CLIPTextEncode")

    def test_text_hint_can_override_or_ignore_generic_classification(self) -> None:
        positive = parse_workflow(
            self.api_workflow,
            self.ui_workflow,
            [
                PromptHint(
                    id="force-positive",
                    class_type="CLIPTextEncode",
                    input_name="text",
                    role="positive",
                )
            ],
        )
        self.assertEqual(
            next(match for match in positive.matches if match.text == "lowres").role,
            "positive",
        )

        ignored = parse_workflow(
            self.api_workflow,
            self.ui_workflow,
            [
                PromptHint(
                    id="ignore-negative",
                    class_type="CLIPTextEncode",
                    input_name="text",
                    role="unknown",
                    ignore=True,
                )
            ],
        )
        self.assertNotIn("lowres", {match.text for match in ignored.matches})

    def test_preserves_unknown_string_inputs_when_no_ui_workflow_is_provided(
        self,
    ) -> None:
        api_workflow = json.loads(
            json.dumps(self.api_workflow).replace(
                '"value": "best quality"', '"value": "best quality", "unknown": "kept"'
            )
        )
        result = parse_workflow(api_workflow, None)
        self.assertIn("kept", {match.text for match in result.matches})


if __name__ == "__main__":
    unittest.main()
