from dataclasses import dataclass
from typing import Literal, override

from ..models import (
    ClaimPriority,
    ConditioningEndpoint,
    ConditioningInput,
    NodeAdapter,
    PromptRole,
    SemanticClaim,
    TextInput,
)


@dataclass
class KnownInput:
    name: str
    type: Literal["conditioning", "text"]
    role: PromptRole | None = None


@dataclass(frozen=True)
class BuiltInNode:
    type: str
    inputs: list[KnownInput]


BUILT_IN_NODES_LIST: list[BuiltInNode] = [
    BuiltInNode(
        "KSampler",
        [
            KnownInput("positive", "conditioning", "positive"),
            KnownInput("negative", "conditioning", "negative"),
        ],
    ),
    BuiltInNode("CLIPTextEncode", [KnownInput("text", "text")]),
]

BUILT_IN_NODES: dict[str, BuiltInNode] = {
    node.type: node for node in BUILT_IN_NODES_LIST
}


class BuiltinNodesAdapter(NodeAdapter):
    @override
    def analyze(self, node, context):
        semantics = context.semantics

        if node.class_type in BUILT_IN_NODES:
            for input in BUILT_IN_NODES[node.class_type].inputs:
                if not input.role:
                    continue

                semantics.add_endpoint(
                    ConditioningEndpoint(
                        node_id=node.id,
                        input_name=input.name,
                        role=input.role,
                        confidence=0.9,
                        initiator=BuiltinNodesAdapter.__name__,
                        claim=SemanticClaim(
                            policy="exclusive", priority=ClaimPriority.GENERAL
                        ),
                    )
                )
                semantics.add_input(
                    ConditioningInput(
                        node_id=node.id,
                        input_name=input.name,
                        output_index=None,
                        confidence=0.9,
                        claim=SemanticClaim(
                            policy="exclusive", priority=ClaimPriority.GENERAL
                        ),
                    )
                )

            for input in BUILT_IN_NODES[node.class_type].inputs:
                if input.type != "text":
                    continue
                semantics.add_input(
                    TextInput(
                        node_id=node.id,
                        input_name=input.name,
                        output_index=None,
                        confidence=0.9,
                        claim=SemanticClaim(
                            policy="exclusive", priority=ClaimPriority.GENERAL
                        ),
                    )
                )
