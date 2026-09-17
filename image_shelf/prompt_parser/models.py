from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from enum import IntEnum
from typing import Any, Literal, TypeVar

T = TypeVar("T")

PromptRole = Literal["positive", "negative", "unknown"]
SourceKind = Literal["tracing", "match"]


class NodeAdapter(ABC):
    @abstractmethod
    def analyze(self, node: Node, context: AnalysisContext) -> None:
        pass


@dataclass(frozen=True)
class AnalysisContext:
    semantics: NodeSemantics


class NodeSemantics:
    def __init__(self):
        self._endpoints: list[SemanticEndpoint] = []
        self._inputs: list[SemanticInput] = []
        self._suppressions: list[
            Callable[[SemanticEndpoint | SemanticInput], bool]
        ] = []

    def _resolve_with_claims[T: SemanticEndpoint | SemanticInput](
        self,
        items: list[T],
        new_item: T,
    ) -> None:
        if any(suppression(new_item) for suppression in self._suppressions):
            return

        def resolve_against(
            existing_items: list[T],
        ) -> None:
            if not existing_items or (
                new_item.claim.exclusive_group
                and all(
                    existing_item.claim.exclusive_group
                    == new_item.claim.exclusive_group
                    for existing_item in existing_items
                )
            ):
                items.append(new_item)
                return

            if new_item.claim.priority > max(
                existing_item.claim.priority for existing_item in existing_items
            ):
                for existing_item in existing_items:
                    items.remove(existing_item)

                items.append(new_item)

        same_node_items = [
            existing_item
            for existing_item in items
            if existing_item.node_id == new_item.node_id
        ]

        if new_item.claim.policy == "node-exclusive" or any(
            existing_item.claim.policy == "node-exclusive"
            for existing_item in same_node_items
        ):
            resolve_against(same_node_items)
            return

        same_identity_items = [
            existing_item
            for existing_item in items
            if existing_item.identity == new_item.identity
        ]

        if new_item.claim.policy == "exclusive" or any(
            existing_item.claim.policy == "exclusive"
            for existing_item in same_identity_items
        ):
            resolve_against(same_identity_items)
            return

        items.append(new_item)

    def add_endpoint(self, endpoint: SemanticEndpoint) -> None:
        self._resolve_with_claims(self._endpoints, endpoint)

    def add_input(self, input: SemanticInput) -> None:
        self._resolve_with_claims(self._inputs, input)

    def suppress(
        self, condition: Callable[[SemanticEndpoint | SemanticInput], bool]
    ) -> None:
        self._suppressions.append(condition)

        for endpoint in self._endpoints[:]:
            if condition(endpoint):
                self._endpoints.remove(endpoint)

        for input in self._inputs[:]:
            if condition(input):
                self._inputs.remove(input)

    def get_endpoints(self) -> list[SemanticEndpoint]:
        return self._endpoints

    def get_inputs(
        self, node_id: str, output_index: int | None = None
    ) -> list[SemanticInput]:
        return [
            input
            for input in self._inputs
            if input.node_id == node_id
            and (
                output_index is None
                or input.output_index is None
                or input.output_index == output_index
            )
        ]


ClaimPolicy = Literal["exclusive", "node-exclusive"]


class ClaimPriority(IntEnum):
    HEURISTIC = 10
    GENERAL = 20
    HINT = 30


@dataclass(frozen=True)
class SemanticClaim:
    policy: ClaimPolicy
    priority: ClaimPriority
    exclusive_group: str | None = None


@dataclass(frozen=True)
class SemanticEndpoint:
    node_id: str
    input_name: str
    role: PromptRole
    confidence: float
    initiator: str
    claim: SemanticClaim

    @property
    def identity(self) -> tuple[str, str]:
        return self.node_id, self.input_name


@dataclass(frozen=True)
class TextEndpoint(SemanticEndpoint):
    pass


@dataclass(frozen=True)
class ConditioningEndpoint(SemanticEndpoint):
    pass


@dataclass(frozen=True, kw_only=True)
class SemanticInput:
    node_id: str
    input_name: str
    output_index: int | None
    confidence: float
    claim: SemanticClaim

    @property
    def identity(self) -> tuple[str, str]:
        return self.node_id, self.input_name


@dataclass(frozen=True)
class TextInput(SemanticInput):
    pass


@dataclass(frozen=True)
class ConditioningInput(SemanticInput):
    pass


HintKind = Literal["text", "conditioning"]


@dataclass(frozen=True)
class PromptHint:
    id: str
    class_type: str
    kind: HintKind = "text"
    input_name: str | None = None
    output_index: int | None = None
    role: PromptRole = "unknown"
    ignore: bool = False


@dataclass(frozen=True)
class Connection:
    node_id: str
    output_index: int


@dataclass(frozen=True)
class InputValue:
    name: str
    value: Any

    @property
    def connection(self) -> Connection | None:
        return self.value if isinstance(self.value, Connection) else None

    @property
    def is_link(self) -> bool:
        return self.connection is not None


@dataclass(frozen=True)
class Node:
    id: str
    class_type: str
    inputs: dict[str, InputValue]
    raw_node: Any


@dataclass(frozen=True)
class PathStep:
    node_id: str
    output_index: int | None
    input_name: str


@dataclass(frozen=True)
class TextCandidate:
    text: str
    node_id: str
    class_type: str
    input_name: str
    path: tuple[PathStep, ...]

    @property
    def identity(self) -> tuple[str, str]:
        return self.node_id, self.input_name


@dataclass(frozen=True)
class PromptMatch:
    text: str
    node_id: str
    class_type: str
    input_name: str
    role: PromptRole
    score: float
    reason: str
    path: tuple[PathStep, ...]


@dataclass(frozen=True)
class PromptParseResult:
    matches: list[PromptMatch]
