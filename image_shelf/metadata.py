from __future__ import annotations

import json
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from PIL import Image

from .models import ParsedWorkflow

_PARENTHESIZED_TAG = re.compile(r"\(([^()]*)\)")
_WEIGHT_SUFFIX = re.compile(r"\s*:\s*[-+]?\d+(?:\.\d+)?\s*$")


def parse_tags(text: str) -> tuple[str, ...]:
    """Normalize ComfyUI prompt text into unique, lower-case comma-separated tags."""
    lowered_text = text.lower()
    unwrapped_text = _PARENTHESIZED_TAG.sub(r"\1", lowered_text)
    tags: list[str] = []
    seen: set[str] = set()

    for value in unwrapped_text.split(","):
        tag = _WEIGHT_SUFFIX.sub("", value).strip()
        if tag and tag not in seen:
            tags.append(tag)
            seen.add(tag)

    return tuple(tags)


def parse_image_workflow(
    path: str | Path, image: Image.Image | None = None
) -> ParsedWorkflow:
    """Read supported image workflow metadata and extract prompt tags."""
    image_path = Path(path)
    extension = image_path.suffix.lower()
    if extension not in {".png", ".jpg", ".jpeg"}:
        return ParsedWorkflow(
            workflow=None,
            tags=(),
            negative_tags=(),
            parse_error="Tag extraction is unsupported for this image format.",
        )

    try:
        if image is None:
            with Image.open(image_path) as opened_image:
                workflow = _read_workflow(opened_image, extension)
        else:
            workflow = _read_workflow(image, extension)
    except Exception as error:
        return ParsedWorkflow(None, (), (), f"Could not read image metadata: {error}")

    if workflow is None:
        return ParsedWorkflow(
            None, (), (), "Image does not contain ComfyUI workflow metadata."
        )

    try:
        workflow_data = json.loads(workflow)
        prompt_text, negative_prompt_text = _find_prompt_texts(workflow_data)
    except (TypeError, ValueError, KeyError) as error:
        return ParsedWorkflow(
            workflow, (), (), f"Could not parse workflow metadata: {error}"
        )

    return ParsedWorkflow(
        workflow=_workflow_for_search(workflow_data),
        tags=parse_tags(prompt_text) if prompt_text else (),
        negative_tags=parse_tags(negative_prompt_text) if negative_prompt_text else (),
        parse_error=None,
    )


def _read_workflow(image: Image.Image, extension: str) -> str | None:
    if extension == ".png":
        workflow = image.info.get("workflow")
    else:
        workflow = image.getexif().get(37510)

    if isinstance(workflow, bytes):
        workflow = workflow.decode("utf-8", errors="replace")
    return workflow if isinstance(workflow, str) else None


def _find_prompt_texts(workflow: Any) -> tuple[str | None, str | None]:
    if not isinstance(workflow, dict):
        raise ValueError("workflow is not an object")

    nodes = workflow.get("nodes")
    if not isinstance(nodes, Iterable):
        raise ValueError("workflow has no nodes list")

    prompt_text: str | None = None
    negative_prompt_text: str | None = None
    for node in nodes:
        if not isinstance(node, dict):
            continue
        title = node.get("title")
        values = node.get("widgets_values")
        if not isinstance(title, str) or not isinstance(values, list) or not values:
            continue
        value = values[0]
        if not isinstance(value, str):
            continue

        normalized_title = title.lower()
        if "negative prompt" in normalized_title and negative_prompt_text is None:
            negative_prompt_text = value
        elif "prompt" in normalized_title and prompt_text is None:
            prompt_text = value

    return prompt_text, negative_prompt_text


def _workflow_for_search(workflow: dict) -> str:
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
    _normalize_workflow_value(keywords, workflow)
    return " ".join(keywords).lower()


def _normalize_workflow_value(keywords: list[str], value: Any) -> None:
    if isinstance(value, dict):
        for k, v in value.items():
            keywords.append(k)
            _normalize_workflow_value(keywords, v)
    elif isinstance(value, list):
        for item in value:
            _normalize_workflow_value(keywords, item)
    elif isinstance(value, str):
        keywords.append(value)
    else:
        # drop non-string primitive values (numbers, booleans, null)
        pass
