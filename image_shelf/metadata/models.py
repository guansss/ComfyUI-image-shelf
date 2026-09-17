from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from ..prompt_parser.models import PromptParseResult


class Parser(ABC):
    @staticmethod
    @abstractmethod
    def can_handle(metadata: dict[str, Any]) -> bool:
        pass

    @staticmethod
    @abstractmethod
    def parse(metadata: dict[str, Any]) -> Any:
        pass


@dataclass(frozen=True)
class ParsedMetadata:
    type: str | None = None
    info: str | dict[str, Any] | None = None
    normalized_info: str | None = None
    prompt: PromptParseResult | dict[str, str | None] | None = None
    tags: tuple[str, ...] = ()
    negative_tags: tuple[str, ...] = ()
    parse_error: str | None = None
