import json
from collections.abc import Mapping
from typing import Any, cast

from ...prompt_parser import parse_workflow
from ...tag.tag_parser import parse_tags, unique_tags
from ...utils.timing import Timings
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
    timings = Timings()

    api_workflow = metadata.get("prompt")
    assert api_workflow is not None, "API workflow is missing"
    if isinstance(api_workflow, str):
        with timings.measure("parse_json"):
            api_workflow = cast(Mapping[str, Any], json.loads(api_workflow))

    ui_workflow = metadata.get("workflow")
    if isinstance(ui_workflow, str):
        with timings.measure("parse_json"):
            ui_workflow = json.loads(ui_workflow)

    prompt_result = parse_workflow(api_workflow, ui_workflow)
    timings.merge("prompt", prompt_result.timings)

    with timings.measure("parse_tags"):
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

    with timings.measure("normalize"):
        normalized_info = _normalize_workflow(api_workflow)

    return ParsedMetadata(
        type="comfy",
        info={
            "prompt": api_workflow,
            "workflow": ui_workflow,
        },
        normalized_info=normalized_info,
        prompt=prompt_result,
        tags=unique_tags(positive),
        negative_tags=unique_tags(negative),
        timings=timings,
    )


def _normalize_workflow(workflow: Mapping[str, Any]) -> str:
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
    stack: list[Any] = [workflow]

    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            for key, child in reversed(list(value.items())):
                stack.append(child)
                stack.append(key)
        elif isinstance(value, list):
            stack.extend(reversed(value))
        elif isinstance(value, str):
            keywords.append(value)
        # Drop non-string primitive values (numbers, booleans, null).

    return " ".join(keywords).lower()
