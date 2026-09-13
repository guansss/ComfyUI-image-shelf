from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from .adapters import AdapterRegistry
from .adapters.builtin import CONDITIONING_SINKS, builtin_adapters
from .graph import WorkflowGraph
from .hints import PromptHint
from .models import (
    MatchSource,
    PathStep,
    PromptMatch,
    PromptParseResult,
    PromptRole,
    TextCandidate,
)

_TEXT_INPUTS = {"text", "value", "prompt", "positive_prompt", "negative_prompt"}


def parse_workflow(
    workflow: Mapping[str, Any],
    hints: Iterable[PromptHint] = (),
    adapters: AdapterRegistry | None = None,
) -> PromptParseResult:
    graph = WorkflowGraph.from_api_workflow(workflow)
    candidates = _extract_candidates(graph)
    hints = tuple(hints)
    adapters = adapters or builtin_adapters()
    matches: list[PromptMatch] = []
    for candidate in candidates:
        hint = _find_text_hint(candidate, hints)
        if hint and hint.ignore:
            continue
        role, confidence, source = _classify(candidate, graph, adapters)
        if hint:
            role = hint.role
            confidence = 1.0
            source = MatchSource("hint", hint_id=hint.id)
        path = candidate.path
        if source.reason in {"KSampler.positive", "KSampler.negative"}:
            path = _path_to_sink(candidate, graph, source.reason)
        matches.append(
            PromptMatch(
                text=candidate.text,
                node_id=candidate.node_id,
                class_type=candidate.class_type,
                input_name=candidate.input_name,
                role=role,
                confidence=confidence,
                source=source,
                path=path,
            )
        )
    return PromptParseResult(_merge_matches(matches))


def _extract_candidates(graph: WorkflowGraph) -> list[TextCandidate]:
    candidates: list[TextCandidate] = []
    for node in graph.nodes():
        for input_value in node.inputs.values():
            if input_value.is_link or not isinstance(input_value.value, str):
                continue
            text = input_value.value.strip()
            if not text or not _looks_like_text_input(
                node.class_type, input_value.name
            ):
                continue
            candidates.append(
                TextCandidate(
                    text=text,
                    node_id=node.id,
                    class_type=node.class_type,
                    input_name=input_value.name,
                    path=(
                        PathStep(node.id, node.class_type, input_name=input_value.name),
                    ),
                )
            )
    return candidates


def _looks_like_text_input(class_type: str, input_name: str) -> bool:
    name = input_name.lower()
    node_name = class_type.lower()
    return name in _TEXT_INPUTS or "text" in node_name or "prompt" in node_name


def _find_text_hint(
    candidate: TextCandidate, hints: tuple[PromptHint, ...]
) -> PromptHint | None:
    for hint in hints:
        if hint.kind != "text" or hint.class_type != candidate.class_type:
            continue
        if hint.input_name is None or hint.input_name == candidate.input_name:
            return hint
    return None


def _classify(
    candidate: TextCandidate,
    graph: WorkflowGraph,
    adapters: AdapterRegistry,
) -> tuple[PromptRole, float, MatchSource]:
    adapter = adapters.get(candidate.class_type)
    if adapter:
        result = adapter(graph.require_node(candidate.node_id), candidate.input_name)
        if result:
            role, confidence, reason = result
            return (
                role,
                confidence,
                MatchSource("adapter", reason=reason, adapter=candidate.class_type),
            )

    for (class_type, input_name), role in CONDITIONING_SINKS.items():
        for node in graph.nodes():
            if (
                node.class_type != class_type
                or graph.get_input_source(node.id, input_name) is None
            ):
                continue
            if _candidate_reaches_sink(candidate, node.id, input_name, graph):
                return (
                    role,
                    0.9,
                    MatchSource("generic", reason=f"{class_type}.{input_name}"),
                )

    name = candidate.input_name.lower()
    if name in {"positive", "positive_prompt"}:
        return "positive", 0.7, MatchSource("generic", reason="input name")
    if name in {"negative", "negative_prompt"}:
        return "negative", 0.7, MatchSource("generic", reason="input name")
    return "unknown", 0.4, MatchSource("generic", reason="text-like input")


def _candidate_reaches_sink(
    candidate: TextCandidate,
    sink_node_id: str,
    sink_input: str,
    graph: WorkflowGraph,
) -> bool:
    source = graph.get_input_source(sink_node_id, sink_input)
    if source is None:
        return False
    stack = [source.node_id]
    visited: set[str] = set()
    while stack:
        node_id = stack.pop()
        if node_id in visited:
            continue
        visited.add(node_id)
        if node_id == candidate.node_id:
            return True
        node = graph.get_node(node_id)
        if node is not None:
            stack.extend(
                connection.node_id for _, connection in graph.iter_input_sources(node)
            )
    return False


def _path_to_sink(
    candidate: TextCandidate,
    graph: WorkflowGraph,
    sink_name: str,
) -> tuple[PathStep, ...]:
    class_type, input_name = sink_name.split(".", 1)
    for sink in graph.nodes():
        if sink.class_type != class_type:
            continue
        source = graph.get_input_source(sink.id, input_name)
        if source is None:
            continue
        initial_path = (
            PathStep(sink.id, sink.class_type, input_name=input_name),
            PathStep(
                source.node_id,
                graph.require_node(source.node_id).class_type,
                output_index=source.output_index,
            ),
        )
        stack = [(source.node_id, initial_path)]
        visited: set[tuple[str, tuple[PathStep, ...]]] = set()
        while stack:
            node_id, path = stack.pop()
            state = (node_id, path)
            if state in visited:
                continue
            visited.add(state)
            if node_id == candidate.node_id:
                return path + (candidate.path[-1],)
            node = graph.get_node(node_id)
            if node is None:
                continue
            for upstream_name, connection in graph.iter_input_sources(node):
                upstream = graph.get_node(connection.node_id)
                if upstream is None:
                    continue
                stack.append(
                    (
                        connection.node_id,
                        path
                        + (
                            PathStep(
                                node.id, node.class_type, input_name=upstream_name
                            ),
                            PathStep(
                                upstream.id,
                                upstream.class_type,
                                output_index=connection.output_index,
                            ),
                        ),
                    )
                )
    return candidate.path


def _merge_matches(matches: list[PromptMatch]) -> list[PromptMatch]:
    merged: dict[tuple[str, str, str], PromptMatch] = {}
    for match in matches:
        key = (match.node_id, match.input_name, match.text)
        previous = merged.get(key)
        if previous is None or match.confidence > previous.confidence:
            merged[key] = match
    return list(merged.values())
