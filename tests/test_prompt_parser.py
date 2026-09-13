import json
import unittest
from pathlib import Path

from image_shelf.prompt_parser import PromptHint, parse_workflow
from image_shelf.prompt_parser.graph import WorkflowGraph

ASSETS = Path(__file__).parent / "assets"


class PromptParserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with open(ASSETS / "api-workflow.json", encoding="utf-8") as workflow_file:
            cls.workflow = json.load(workflow_file)

    def test_extracts_positive_and_negative_prompts_from_api_workflow(self) -> None:
        result = parse_workflow(self.workflow)
        matches = {(match.text, match.role) for match in result.matches}
        self.assertIn(("best quality", "positive"), matches)
        self.assertIn(("lowres", "negative"), matches)
        self.assertNotIn(("951432413360540", "unknown"), matches)

    def test_preserves_paths_and_colon_node_ids(self) -> None:
        result = parse_workflow(self.workflow)
        positive = next(
            match for match in result.matches if match.text == "best quality"
        )
        self.assertEqual(positive.node_id, "16")
        self.assertTrue(any(step.node_id == "12:3" for step in positive.path))
        graph = WorkflowGraph.from_api_workflow(self.workflow)
        self.assertEqual(graph.require_node("12:13:5").class_type, "CLIPTextEncode")

    def test_text_hint_can_override_or_ignore_generic_classification(self) -> None:
        positive = parse_workflow(
            self.workflow,
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
            self.workflow,
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

    def test_malformed_connections_are_kept_as_literals(self) -> None:
        graph = WorkflowGraph.from_api_workflow(
            {
                "node": {
                    "class_type": "PromptNode",
                    "inputs": {"text": ["missing"], "value": "kept"},
                }
            }
        )
        self.assertIsNone(graph.get_input_source("node", "text"))
        self.assertEqual(graph.get_input("node", "value").value, "kept")


if __name__ == "__main__":
    unittest.main()
