from collections.abc import Iterable
from typing import override

from ..models import (
    ClaimPriority,
    ConditioningEndpoint,
    NodeAdapter,
    PromptHint,
    SemanticClaim,
    TextEndpoint,
)


class HintAdapter(NodeAdapter):
    def __init__(self, hints: Iterable[PromptHint]):
        self.hints = tuple(hints)

    @override
    def analyze(self, node, context):
        semantics = context.semantics

        hints = [hint for hint in self.hints if hint.class_type == node.class_type]
        input_hints = [hint for hint in hints if hint.input_name]

        for hint in input_hints:
            assert hint.input_name

            if hint.ignore:
                semantics.suppress(
                    lambda item, hint=hint: (
                        item.node_id == node.id and item.input_name == hint.input_name
                    )
                )
            elif hint.kind == "conditioning":
                semantics.add_endpoint(
                    ConditioningEndpoint(
                        node_id=node.id,
                        input_name=hint.input_name,
                        role=hint.role,
                        confidence=1.0,
                        initiator=f"hint-{hint.id}",
                        claim=SemanticClaim(
                            policy="exclusive", priority=ClaimPriority.HINT
                        ),
                    )
                )
            elif hint.kind == "text":
                semantics.add_endpoint(
                    TextEndpoint(
                        node_id=node.id,
                        input_name=hint.input_name,
                        role=hint.role,
                        confidence=1.0,
                        initiator=f"hint-{hint.id}",
                        claim=SemanticClaim(
                            policy="exclusive", priority=ClaimPriority.HINT
                        ),
                    )
                )
