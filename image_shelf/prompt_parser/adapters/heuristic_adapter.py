from collections.abc import Mapping
from typing import Any, override

from ..models import (
    ClaimPriority,
    ConditioningEndpoint,
    ConditioningInput,
    NodeAdapter,
    PromptRole,
    SemanticClaim,
    SemanticInput,
    TextInput,
)


class HeuristicAdapter(NodeAdapter):
    def __init__(self, ui_workflow: Mapping[str, Any] | None = None):
        self._ui_workflow = ui_workflow
        self._nodes = {}

        if not ui_workflow:
            return

        if "nodes" in ui_workflow and isinstance(ui_workflow["nodes"], list):
            self._nodes = {str(node["id"]): node for node in ui_workflow["nodes"]}

        if (
            "definitions" in ui_workflow
            and isinstance(ui_workflow["definitions"], dict)
            and "subgraphs" in ui_workflow["definitions"]
            and isinstance(ui_workflow["definitions"]["subgraphs"], dict)
            and "nodes" in ui_workflow["definitions"]["subgraphs"]
            and isinstance(ui_workflow["definitions"]["subgraphs"]["nodes"], list)
        ):
            self._nodes.update(
                {
                    str(node["id"]): node
                    for node in ui_workflow["definitions"]["subgraphs"]["nodes"]
                }
            )

    @override
    def analyze(self, node, context):
        semantics = context.semantics

        claim = SemanticClaim(
            policy="node-exclusive",
            priority=ClaimPriority.HEURISTIC,
            exclusive_group=HeuristicAdapter.__name__,
        )

        if not self._ui_workflow:
            for name, input in node.inputs.items():
                if isinstance(input.value, str):
                    semantics.add_input(
                        TextInput(
                            node_id=node.id,
                            input_name=input.name,
                            output_index=None,
                            confidence=0.1,
                            claim=claim,
                        )
                    )
                elif input.is_link:
                    semantics.add_input(
                        SemanticInput(
                            node_id=node.id,
                            input_name=input.name,
                            output_index=None,
                            confidence=0.1,
                            claim=claim,
                        )
                    )
            return

        ui_node_id = node.id.split(":")[-1]
        ui_node = self._nodes.get(ui_node_id, {})
        ui_inputs = ui_node.get("inputs", [])

        conditioning_input_names: list[str] = [
            input["name"] for input in ui_inputs if input.get("type") == "CONDITIONING"
        ]

        for input in conditioning_input_names:
            role, confidence = guess_conditioning_role(input)
            semantics.add_endpoint(
                ConditioningEndpoint(
                    node_id=node.id,
                    input_name=input,
                    role=role,
                    confidence=confidence,
                    initiator=HeuristicAdapter.__name__,
                    claim=claim,
                )
            )

        text_input_names: list[str] = []

        for name, input in node.inputs.items():
            if isinstance(input.value, str):
                text_input_names.append(name)
            elif input.is_link and ui_inputs:
                input_slot = next(input for input in ui_inputs if input["name"] == name)
                if input_slot.get("type") == "STRING":
                    text_input_names.append(name)

        ui_outputs = ui_node.get("outputs", [])
        ui_conditioning_outputs = [
            (index, output)
            for index, output in enumerate(ui_outputs)
            if output.get("type") == "CONDITIONING"
        ]
        ui_text_outputs = [
            (index, output)
            for index, output in enumerate(ui_outputs)
            if output.get("type") == "STRING"
        ]

        homogeneous_outputs = (
            ui_conditioning_outputs if len(ui_text_outputs) == 0 else ui_text_outputs
        )
        homogeneous_input_names = (
            conditioning_input_names if len(text_input_names) == 0 else text_input_names
        )

        if (
            homogeneous_outputs
            and homogeneous_input_names
            and len(homogeneous_outputs) == len(homogeneous_input_names)
        ):
            for input, (output_index, _) in zip(
                homogeneous_input_names, homogeneous_outputs
            ):
                if homogeneous_input_names == conditioning_input_names:
                    semantics.add_input(
                        ConditioningInput(
                            node_id=node.id,
                            input_name=input,
                            output_index=output_index,
                            confidence=0.2,
                            claim=claim,
                        )
                    )
                elif homogeneous_input_names == text_input_names:
                    semantics.add_input(
                        TextInput(
                            node_id=node.id,
                            input_name=input,
                            output_index=output_index,
                            confidence=0.2,
                            claim=claim,
                        )
                    )
        else:
            for input in conditioning_input_names:
                semantics.add_input(
                    ConditioningInput(
                        node_id=node.id,
                        input_name=input,
                        output_index=None,
                        confidence=0.1,
                        claim=claim,
                    )
                )
            for input in text_input_names:
                semantics.add_input(
                    TextInput(
                        node_id=node.id,
                        input_name=input,
                        output_index=None,
                        confidence=0.1,
                        claim=claim,
                    )
                )


def guess_conditioning_role(input_name: str) -> tuple[PromptRole, float]:
    name = input_name.lower().strip()

    if "negative" in name:
        return "negative", 0.2

    if "positive" in name or "prompt" in name:
        return "positive", 0.2

    return "unknown", 0.1
