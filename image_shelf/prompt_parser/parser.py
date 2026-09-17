from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from typing import Any

from .adapters.builtin_nodes_adapter import BuiltinNodesAdapter
from .adapters.heuristic_adapter import HeuristicAdapter
from .adapters.hint_adapter import HintAdapter
from .graph import APIWorkflowGraph
from .models import (
    AnalysisContext,
    NodeAdapter,
    NodeSemantics,
    PathStep,
    PromptHint,
    PromptMatch,
    PromptParseResult,
    SemanticEndpoint,
)


def parse_workflow(
    api_workflow: Mapping[str, Any],
    ui_workflow: Mapping[str, Any] | None = None,
    hints: Iterable[PromptHint] = (),
) -> PromptParseResult:
    graph = APIWorkflowGraph.from_api_workflow(api_workflow)

    adapters: list[NodeAdapter] = [
        BuiltinNodesAdapter(),
        HintAdapter(hints),
        HeuristicAdapter(ui_workflow),
    ]

    semantics = NodeSemantics()
    context = AnalysisContext(semantics=semantics)

    for node in graph.nodes():
        for adapter in adapters:
            adapter.analyze(node, context)

    matches: list[PromptMatch] = []

    for endpoint in semantics.get_endpoints():
        endpoint_node = graph.require_node(endpoint.node_id)

        for step in _trace_upstream(graph, semantics, endpoint):
            node = graph.get_node(step.node_id)
            if not node:
                continue

            input = graph.get_input(step.node_id, step.input_name)

            if input and isinstance(input.value, str) and input.value.strip():
                matches.append(
                    PromptMatch(
                        text=input.value,
                        node_id=step.node_id,
                        class_type=node.class_type,
                        input_name=input.name,
                        role=endpoint.role,
                        score=step.score,
                        reason=f"{endpoint.initiator}:{endpoint_node.class_type}.{endpoint.input_name}",
                        path=step.path,
                    )
                )

    return PromptParseResult(_merge_matches(matches))


@dataclass(frozen=True)
class TraversalStep:
    node_id: str
    input_name: str
    score: float
    path: tuple[PathStep, ...]


def _trace_upstream(
    graph: APIWorkflowGraph,
    semantics: NodeSemantics,
    endpoint: SemanticEndpoint,
) -> Iterator[TraversalStep]:
    stack: list[TraversalStep] = [
        TraversalStep(
            node_id=endpoint.node_id,
            input_name=endpoint.input_name,
            score=endpoint.confidence,
            path=(
                PathStep(
                    node_id=endpoint.node_id,
                    input_name=endpoint.input_name,
                    output_index=None,
                ),
            ),
        )
    ]
    visited: set[tuple[str, int]] = set()
    count = 0

    while stack:
        count += 1
        if count > 1000:
            raise RecursionError("Too many traversal steps, exceeded 1000")

        current_step = stack.pop()

        if (current_step.node_id, current_step.input_name) in visited:
            continue
        visited.add((current_step.node_id, current_step.input_name))

        yield current_step

        source = graph.get_input_source(current_step.node_id, current_step.input_name)

        if source:
            semantic_inputs = semantics.get_inputs(source.node_id, source.output_index)

            for semantic_input in semantic_inputs:
                stack.append(
                    TraversalStep(
                        node_id=source.node_id,
                        input_name=semantic_input.input_name,
                        score=max(current_step.score, semantic_input.confidence),
                        path=current_step.path
                        + (
                            PathStep(
                                node_id=source.node_id,
                                input_name=semantic_input.input_name,
                                output_index=source.output_index,
                            ),
                        ),
                    )
                )


def _merge_matches(matches: list[PromptMatch]) -> list[PromptMatch]:
    merged: dict[tuple[str, str, str], PromptMatch] = {}
    for match in matches:
        key = (match.node_id, match.input_name, match.text)
        previous = merged.get(key)
        if previous is None or match.score > previous.score:
            merged[key] = match
    return list(merged.values())
