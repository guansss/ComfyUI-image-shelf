from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .models import PromptRole

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
