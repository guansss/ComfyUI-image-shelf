from ..models import (
    ClaimPriority,
    ConditioningEndpoint,
    ConditioningInput,
    NodeAdapter,
    SemanticClaim,
    TextInput,
)

ENDPOINTS = {
    "KSampler": {"positive": "positive", "negative": "negative"},
}

TEXTS = {
    "CLIPTextEncode": ("text",),
}


class BuiltinNodesAdapter(NodeAdapter):
    def analyze(self, node, context):
        semantics = context.semantics

        if node.class_type in ENDPOINTS:
            for input_name, role in ENDPOINTS[node.class_type].items():
                semantics.add_endpoint(
                    ConditioningEndpoint(
                        node_id=node.id,
                        input_name=input_name,
                        role=role,
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
                        input_name=input_name,
                        output_index=None,
                        confidence=0.9,
                        claim=SemanticClaim(
                            policy="exclusive", priority=ClaimPriority.GENERAL
                        ),
                    )
                )

        if node.class_type in TEXTS:
            for input_name in TEXTS[node.class_type]:
                semantics.add_input(
                    TextInput(
                        node_id=node.id,
                        input_name=input_name,
                        output_index=None,
                        confidence=0.9,
                        claim=SemanticClaim(
                            policy="exclusive", priority=ClaimPriority.GENERAL
                        ),
                    )
                )
