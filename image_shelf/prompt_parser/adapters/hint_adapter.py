from collections import defaultdict
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
        self.hints_by_class: dict[str, tuple[PromptHint, ...]] = {
            class_type: tuple(class_hints)
            for class_type, class_hints in self._group_hints(hints).items()
        }

    @staticmethod
    def _group_hints(
        hints: Iterable[PromptHint],
    ) -> dict[str, list[PromptHint]]:
        grouped: defaultdict[str, list[PromptHint]] = defaultdict(list)
        for hint in hints:
            grouped[hint.class_type].append(hint)
        return grouped

    @override
    def analyze(self, node, context):
        semantics = context.semantics

        for hint in self.hints_by_class.get(node.class_type, ()):
            if not hint.input_name:
                continue

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
