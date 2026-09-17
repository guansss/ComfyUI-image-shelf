# pyrefly: ignore-errors[unsupported-operation]

import re
from typing import Any, cast

from ...tag.tag_parser import (
    escape_important,
    parse_tags,
    unescape_important,
    unique_tags,
)
from ..models import ParsedMetadata, Parser

# A1111's generation parameters line starts with fields such as:
# Steps: 20, Sampler: Euler a, CFG scale: 7, ...
#
# We only need to recognize that such a parameter section exists.
_PARAMETERS_RE = re.compile(
    r"(?:^|\n)Steps:\s*\d+,",
    re.MULTILINE,
)


class A1111Parser(Parser):
    @staticmethod
    def can_handle(metadata: dict[str, Any]) -> bool:
        infotext = metadata.get("parameters") or metadata.get("usercomment")
        return bool(isinstance(infotext, str) and _PARAMETERS_RE.search(infotext))

    @staticmethod
    def parse(metadata: dict[str, Any]) -> ParsedMetadata:
        try:
            return _parse(metadata)
        except Exception as e:
            return ParsedMetadata(
                type="a1111",
                parse_error=str(e),
            )


def _parse(metadata: dict[str, Any]) -> ParsedMetadata:
    infotext = metadata.get("parameters") or metadata.get("usercomment")
    assert isinstance(infotext, str), "Infotext must be a string"

    match = _PARAMETERS_RE.search(infotext)
    assert match, "No parameters section found in infotext"

    parameters_start = match.start()

    # Everything before "Steps: ..." is the prompt section.
    prompt_section = infotext[:parameters_start].rstrip()

    # A1111 uses this exact marker for the negative prompt.
    negative_marker = "\nNegative prompt:"

    negative_prompt: str | None = None

    if negative_marker in prompt_section:
        prompt, negative_prompt = prompt_section.split(
            negative_marker,
            1,
        )
        prompt = prompt.rstrip()
        negative_prompt = negative_prompt.strip()
    else:
        prompt = prompt_section.strip()

    return ParsedMetadata(
        type="a1111",
        info=infotext,
        normalized_info=infotext,
        prompt=(
            {
                "prompt": prompt,
                "negative_prompt": negative_prompt,
            }
            if prompt
            else None
        ),
        tags=_parse_a1111_tags(prompt) if prompt else (),
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
    prompt = "".join(cast(str, text) if text != "BREAK" else "," for text, _ in res)

    prompt = unescape_important(prompt)

    return unique_tags(
        parse_tags(prompt) + tuple(net.lower() for net in extra_networks)
    )


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
