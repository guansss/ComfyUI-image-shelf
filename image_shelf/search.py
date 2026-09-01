from __future__ import annotations

import shlex
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


def parse_search_query(query: str) -> tuple[SearchTerm, ...]:
    """Parse the documented Image Shelf search language into AND-ed terms."""
    try:
        tokens = shlex.split(query, posix=True)
    except ValueError as error:
        raise ValueError(f"Invalid search query: {error}") from error

    terms: list[SearchTerm] = []
    for token in tokens:
        if not token:
            continue
        terms.append(_parse_token(token))
    return tuple(terms)


def _parse_token(token: str) -> SearchTerm:
    excluded = token.startswith("-")
    if excluded:
        token = token[1:]

    if token.startswith("name:"):
        value = token.removeprefix("name:")
        return _term("name", value, excluded)
    if token.startswith("prompt:"):
        value = token.removeprefix("prompt:")
        return _term("prompt", value, excluded)
    if token.startswith("tag:"):
        value = token.removeprefix("tag:")
        tag_type: TagType = "positive"
        if value.startswith("-"):
            value = value[1:]
            tag_type = "negative"
        return _term("tag", value, excluded, tag_type)
    return _term("tag", token, excluded)


def _term(
    field: SearchField,
    value: str,
    excluded: bool,
    tag_type: TagType = "positive",
) -> SearchTerm:
    normalized_value = value.strip().lower()
    if not normalized_value:
        raise ValueError(f"Search term for {field} cannot be empty")
    return SearchTerm(field, normalized_value, excluded, tag_type)