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
        self.hints_by_class: dict[str, list[PromptHint]] = defaultdict(list)
        self.hints_by_title: dict[str, list[PromptHint]] = defaultdict(list)

        for hint in hints:
            # if both class_type and title are present, class_type takes precedence
            if hint.class_type:
                self.hints_by_class[hint.class_type].append(hint)
            elif hint.title:
                self.hints_by_title[hint.title].append(hint)

    @override
    def analyze(self, node, context):
        semantics = context.semantics

        matched_hints = self.hints_by_class.get(node.class_type, []) + (
            self.hints_by_title.get(node.title, []) if node.title else []
        )

        for hint in matched_hints:
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
