from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

PromptRole = Literal["positive", "negative", "unknown"]
SourceKind = Literal["generic", "adapter", "hint"]


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


@dataclass(frozen=True)
class PathStep:
    node_id: str
    class_type: str
    input_name: str | None = None
    output_index: int | None = None


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
class MatchSource:
    kind: SourceKind
    reason: str | None = None
    adapter: str | None = None
    hint_id: str | None = None


@dataclass(frozen=True)
class PromptMatch:
    text: str
    node_id: str
    class_type: str
    input_name: str
    role: PromptRole
    confidence: float
    source: MatchSource
    path: tuple[PathStep, ...]


@dataclass(frozen=True)
class PromptParseResult:
    matches: list[PromptMatch]
