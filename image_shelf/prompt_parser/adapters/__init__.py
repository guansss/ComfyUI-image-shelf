from __future__ import annotations

from collections.abc import Callable

from ..models import Node, PromptRole

RoleAdapter = Callable[[Node, str], tuple[PromptRole, float, str] | None]


class AdapterRegistry:
    def __init__(self) -> None:
        self._adapters: dict[str, RoleAdapter] = {}

    def register(self, class_type: str, adapter: RoleAdapter) -> None:
        self._adapters[class_type] = adapter

    def get(self, class_type: str) -> RoleAdapter | None:
        return self._adapters.get(class_type)
