import re

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


def unique_tags(tags: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(tags))


def escape_important(text):
    text = text.replace("\\)", "\0\1")
    text = text.replace("\\(", "\0\2")
    return text


def unescape_important(text):
    text = text.replace("\0\1", "\\)")
    text = text.replace("\0\2", "\\(")
    return text
