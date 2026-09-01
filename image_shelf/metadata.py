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


def parse_image_workflow(path: str | Path) -> ParsedWorkflow:
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
        with Image.open(image_path) as image:
            workflow = _read_workflow(image, extension)
    except Exception as error:
        return ParsedWorkflow(None, (), (), f"Could not read image metadata: {error}")

    if workflow is None:
        return ParsedWorkflow(None, (), (), "Image does not contain ComfyUI workflow metadata.")

    try:
        workflow_data = json.loads(workflow)
        prompt_text, negative_prompt_text = _find_prompt_texts(workflow_data)
    except (TypeError, ValueError, KeyError) as error:
        return ParsedWorkflow(workflow, (), (), f"Could not parse workflow metadata: {error}")

    return ParsedWorkflow(
        workflow=workflow,
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