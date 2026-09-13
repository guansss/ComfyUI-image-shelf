import json
import logging
from typing import Any

from ...prompt_parser import parse_workflow
from ...tag.tag_parser import parse_tags, unique_tags
from ..models import ParsedMetadata, Parser


class ComfyParser(Parser):
    @staticmethod
    def can_handle(metadata: dict[str, Any]) -> bool:
        return bool(metadata.get("prompt"))

    @staticmethod
    def parse(metadata: dict[str, Any]) -> ParsedMetadata:
        try:
            return _parse(metadata)
        except Exception as e:
            return ParsedMetadata(
                type="comfy",
                parse_error=str(e),
            )


def _parse(metadata: dict[str, Any]) -> ParsedMetadata:
    api_workflow = json.loads(metadata.get("prompt"))
    ui_workflow = json.loads(metadata.get("workflow", "null"))

    prompt_result = parse_workflow(api_workflow)
    positive = tuple(
        tag
        for match in prompt_result.matches
        if match.role == "positive"
        for tag in parse_tags(match.text)
    )
    negative = tuple(
        tag
        for match in prompt_result.matches
        if match.role == "negative"
        for tag in parse_tags(match.text)
    )
    return ParsedMetadata(
        type="comfy",
        info={
            "prompt": api_workflow,
            "workflow": ui_workflow,
        },
        normalized_info=_normalize_workflow(api_workflow),
        prompt=prompt_result,
        tags=unique_tags(positive),
        negative_tags=unique_tags(negative),
    )


def _normalize_workflow(workflow: dict) -> str:
    """
    Convert workflow data into a normalized string representation for consistent comparison.
    String values and object keys are extracted and concatenated, while non-string primitive
    values (numbers, booleans, null) are dropped since they are unlikely to be searched by the user.

    Example: `{"nodes": [{"id": 1, "widgets_values": ["prompt", 123]}]}`
    -> `"nodes id widgets_values prompt"`

    Additionally, having multiple images with workflows that only differ in
    random seeds is a common case in image generation, so dropping numbers helps
    to eliminate these irrelevant differences to avoid storing multiple copies
    of the same workflow.
    """
    keywords: list[str] = []

    def _normalize(value: Any) -> None:
        if isinstance(value, dict):
            for k, v in value.items():
                keywords.append(k)
                _normalize(v)
        elif isinstance(value, list):
            for item in value:
                _normalize(item)
        elif isinstance(value, str):
            keywords.append(value)
        else:
            # drop non-string primitive values (numbers, booleans, null)
            pass

    _normalize(workflow)
    return " ".join(keywords).lower()
