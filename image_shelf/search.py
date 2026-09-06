from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

SearchField = Literal["name", "prompt", "tag"]
TagType = Literal["negative", "positive"]


@dataclass(frozen=True)
class SearchTerm:
    field: SearchField
    value: str
    excluded: bool = False
    tag_type: TagType = "positive"
