from __future__ import annotations

import json
import re
from typing import Any

from PIL import ExifTags, Image

from .models import ParsedWorkflow

_PARENTHESIZED_TAG = re.compile(r"\(([^()]*)\)")
_WEIGHT_SUFFIX = re.compile(r"\s*:\s*[-+]?\d+(?:\.\d+)?\s*$")


def parse_tags(prompt: str) -> tuple[str, ...]:
    """
    Normalize prompt text into unique, lower-case comma-separated tags.
    Supports common syntax for ComfyUI and A1111.
    """
    prompt = prompt.lower()
    prompt = escape_important(prompt)
    unwrapped_text = _PARENTHESIZED_TAG.sub(r"\1", prompt)
    tags: list[str] = []
    seen: set[str] = set()

    for value in unwrapped_text.split(","):
        tag = _WEIGHT_SUFFIX.sub("", value).strip()
        if tag and tag not in seen:
            tags.append(tag)
            seen.add(tag)

    return tuple(unescape_important(tag) for tag in tags)


def escape_important(text):
    text = text.replace("\\)", "\0\1")
    text = text.replace("\\(", "\0\2")
    return text


def unescape_important(text):
    text = text.replace("\0\1", "\\)")
    text = text.replace("\0\2", "\\(")
    return text


def get_image_workflow(image: Image.Image | None = None) -> ParsedWorkflow:
    """Read supported image workflow metadata and extract prompt tags."""
    try:
        info = _read_image_info(image)
        if not info:
            raise ValueError("No metadata found in image.")

        return _parse_workflow(info)
    except Exception as error:
        return ParsedWorkflow(None, (), (), f"Could not read image metadata: {error}")


def _read_image_info(image: Image.Image) -> str | None:
    if image.format == "PNG":
        # Comfy: "workflow", A1111: "parameters"
        data = image.info.get("workflow") or image.info.get("parameters")
    else:
        exif = image.getexif()
        data = exif.get(ExifTags.Base.UserComment)
        if data is None:
            exif_ifd = exif.get_ifd(ExifTags.Base.ExifOffset)
            data = exif_ifd.get(ExifTags.Base.UserComment) if exif_ifd else None

    if isinstance(data, bytes):
        if data.startswith(b"UNICODE\0"):
            # A1111 uses Piexif to encode the UserComment with "unicode" encoding, which is actually UTF-16BE
            # https://github.com/hMatoba/Piexif/blob/3422fbe7a12c3ebcc90532d8e1f4e3be32ece80c/piexif/helper.py#L15
            data = data[8:].decode("utf-16_be", errors="replace")
        elif data.startswith(b"ASCII\0\0\0"):
            data = data[8:].decode("ascii", errors="replace")
        elif data.startswith(b"JIS\0\0\0\0\0"):
            data = data[8:].decode("shift_jis", errors="replace")
        else:
            data = data.decode("utf-8", errors="replace")

    return data if isinstance(data, str) else None


def _parse_workflow(info: str) -> ParsedWorkflow:
    workflow: Any = None
    try:
        workflow = json.loads(info)
    except (TypeError, ValueError, KeyError):
        pass
    if isinstance(workflow, dict):
        return _parse_comfy_workflow(workflow)
    workflow = _parse_a1111_info(info)
    if workflow is not None:
        return workflow
    raise ValueError("Metadata is not one of the supported formats (ComfyUI or A1111).")


def _parse_comfy_workflow(workflow: dict) -> ParsedWorkflow:
    nodes = workflow.get("nodes")
    if not isinstance(nodes, list):
        raise TypeError("workflow has no nodes list")

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

    return ParsedWorkflow(
        workflow=_comfy_workflow_for_search(workflow),
        tags=parse_tags(prompt_text) if prompt_text else (),
        negative_tags=parse_tags(negative_prompt_text) if negative_prompt_text else (),
    )


def _comfy_workflow_for_search(workflow: dict) -> str:
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


# A1111's generation parameters line starts with fields such as:
# Steps: 20, Sampler: Euler a, CFG scale: 7, ...
#
# We only need to recognize that such a parameter section exists.
_PARAMETERS_RE = re.compile(
    r"(?:^|\n)Steps:\s*\d+,",
    re.MULTILINE,
)


def _parse_a1111_info(infotext: str) -> ParsedWorkflow | None:
    # First make sure this actually looks like A1111 infotext.
    match = _PARAMETERS_RE.search(infotext)
    if not match:
        return None

    parameters_start = match.start()

    # Everything before "Steps: ..." is the prompt section.
    prompt_section = infotext[:parameters_start].rstrip()

    # A1111 uses this exact marker for the negative prompt.
    negative_marker = "\nNegative prompt:"

    negative_prompt = None

    if negative_marker in prompt_section:
        prompt, negative_prompt = prompt_section.split(
            negative_marker,
            1,
        )
        prompt = prompt.rstrip()
        negative_prompt = negative_prompt.strip()
    else:
        prompt = prompt_section.strip()

    if not prompt:
        return None

    return ParsedWorkflow(
        workflow=infotext,
        tags=_parse_a1111_tags(prompt),
        negative_tags=_parse_a1111_tags(negative_prompt) if negative_prompt else (),
    )


def _parse_a1111_tags(prompt: str) -> tuple[str, ...]:
    # Extract extra network tags *before* parsing the prompt, otherwise parentheses
    # in the extra network tags will be misinterpreted as attention tokens and stripped.
    prompt, extra_networks = _extract_extra_networks(prompt)

    # _parse_prompt_attention will convert "\(" and "\)" into literal "(" and ")",
    # but we need to preserve them for the tag parsing, so we escape them first.
    prompt = escape_important(prompt)

    # This step essentially removes all the brackets and weights from the prompt, leaving only the text.
    # >>> _parse_a1111_prompt("a (((house:1.3)) BREAK [on] a (hill:0.5), sun, (((sky))).")
    # 'a house , on a hill, sun, sky.'
    res = _parse_prompt_attention(prompt)
    prompt = "".join(text if text != "BREAK" else "," for text, _ in res)

    prompt = unescape_important(prompt)
    return parse_tags(prompt) + tuple(net.lower() for net in extra_networks)


re_attention = re.compile(
    r"""
\\\(|
\\\)|
\\\[|
\\]|
\\\\|
\\|
\(|
\[|
:\s*([+-]?[.\d]+)\s*\)|
\)|
]|
[^\\()\[\]:]+|
:
""",
    re.X,
)
re_break = re.compile(r"\s*\bBREAK\b\s*", re.S)


# This function is copied from A1111's source code:
# https://github.com/AUTOMATIC1111/stable-diffusion-webui/blob/82a973c04367123ae98bd9abdf80d9eda9b910e2/modules/prompt_parser.py#L352-L458
def _parse_prompt_attention(text):
    """
    Parses a string with attention tokens and returns a list of pairs: text and its associated weight.
    Accepted tokens are:
      (abc) - increases attention to abc by a multiplier of 1.1
      (abc:3.12) - increases attention to abc by a multiplier of 3.12
      [abc] - decreases attention to abc by a multiplier of 1.1
      \( - literal character '('
      \[ - literal character '['
      \) - literal character ')'
      \] - literal character ']'
      \\ - literal character '\'
      anything else - just text

    >>> parse_prompt_attention('normal text')
    [['normal text', 1.0]]
    >>> parse_prompt_attention('an (important) word')
    [['an ', 1.0], ['important', 1.1], [' word', 1.0]]
    >>> parse_prompt_attention('(unbalanced')
    [['unbalanced', 1.1]]
    >>> parse_prompt_attention('\(literal\]')
    [['(literal]', 1.0]]
    >>> parse_prompt_attention('(unnecessary)(parens)')
    [['unnecessaryparens', 1.1]]
    >>> parse_prompt_attention('a (((house:1.3)) [on] a (hill:0.5), sun, (((sky))).')
    [['a ', 1.0],
     ['house', 1.5730000000000004],
     [' ', 1.1],
     ['on', 1.0],
     [' a ', 1.1],
     ['hill', 0.55],
     [', sun, ', 1.1],
     ['sky', 1.4641000000000006],
     ['.', 1.1]]
    """

    res = []
    round_brackets = []
    square_brackets = []

    round_bracket_multiplier = 1.1
    square_bracket_multiplier = 1 / 1.1

    def multiply_range(start_position, multiplier):
        for p in range(start_position, len(res)):
            res[p][1] *= multiplier

    for m in re_attention.finditer(text):
        text = m.group(0)
        weight = m.group(1)

        if text.startswith("\\"):
            res.append([text[1:], 1.0])
        elif text == "(":
            round_brackets.append(len(res))
        elif text == "[":
            square_brackets.append(len(res))
        elif weight is not None and round_brackets:
            multiply_range(round_brackets.pop(), float(weight))
        elif text == ")" and round_brackets:
            multiply_range(round_brackets.pop(), round_bracket_multiplier)
        elif text == "]" and square_brackets:
            multiply_range(square_brackets.pop(), square_bracket_multiplier)
        else:
            parts = re.split(re_break, text)
            for i, part in enumerate(parts):
                if i > 0:
                    res.append(["BREAK", -1])
                res.append([part, 1.0])

    for pos in round_brackets:
        multiply_range(pos, round_bracket_multiplier)

    for pos in square_brackets:
        multiply_range(pos, square_bracket_multiplier)

    if len(res) == 0:
        res = [["", 1.0]]

    # merge runs of identical weights
    i = 0
    while i + 1 < len(res):
        if res[i][1] == res[i + 1][1]:
            res[i][0] += res[i + 1][0]
            res.pop(i + 1)
        else:
            i += 1

    return res


re_extra_net = re.compile(r"<\w+:[^>]+>")


def _extract_extra_networks(prompt: str) -> tuple[str, list[str]]:
    """
    Extract extra network tags from the prompt, e.g. "<lora:my_lora:0.5>",
    and return the prompt with those tags removed.

    According to A1111's comment: https://github.com/AUTOMATIC1111/stable-diffusion-webui/blob/82a973c04367123ae98bd9abdf80d9eda9b910e2/modules/extra_networks.py#L58-L61
    The text behind the colon is not a specific "weight", but rather a general-purpose
    argument, and there can be multiple arguments separated by colons. So we cannot simply
    remove everything after the first colon, but instead we should keep the entire tag as-is.
    As a result, "<lora:my_lora:0.5>" and "<lora:my_lora:1.0>" are considered different tags.
    """
    extra_networks: list[str] = []

    def _replace_extra_net(match):
        extra_networks.append(match.group(0))
        return ""

    prompt_without_extra_nets = re_extra_net.sub(_replace_extra_net, prompt)

    return (
        prompt_without_extra_nets,
        extra_networks,
    )
