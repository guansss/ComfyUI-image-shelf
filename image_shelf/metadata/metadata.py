from __future__ import annotations

import io
from typing import Any

from PIL import Image

from ..error import NotRecognizedError
from ..utils.jpeg import decode_usercomment, get_usercomment, read_jpeg_metadata
from ..utils.timing import Timings
from .models import ParsedMetadata, Parser
from .parser.a1111_parser import A1111Parser
from .parser.comfy_parser import ComfyParser

metadata_parsers: list[type[Parser]] = [ComfyParser, A1111Parser]


def get_image_metadata(
    image_bytes: bytes, image: Image.Image | None = None
) -> ParsedMetadata:
    timings = Timings()
    try:
        with timings.measure("read_metadata"):
            if not image:
                with Image.open(io.BytesIO(image_bytes)) as opened_image:
                    metadata = _read_image_metadata(opened_image, image_bytes)
            else:
                metadata = _read_image_metadata(image, image_bytes)
            if not metadata:
                raise ValueError("No metadata found in image.")

        parsed_metadata = parse_metadata(metadata)
        if parsed_metadata.timings:
            parsed_metadata.timings.merge(None, timings)

        return parsed_metadata
    except Exception as error:
        return ParsedMetadata(
            type="unknown",
            parse_error=f"Could not read image metadata: {error}",
        )


def _read_image_metadata(
    image: Image.Image, image_bytes: bytes
) -> dict[str, Any] | None:
    if image.format == "PNG":
        # Only preserve string keys, and I don't know the usage of the tuple keys
        return {k: v for k, v in image.info.items() if isinstance(k, str)}
    else:
        try:
            metadata, _ = read_jpeg_metadata(image, image_bytes)
            return metadata
        except NotRecognizedError:
            pass

        exif = image.getexif()
        usercomment = get_usercomment(exif)
        if usercomment:
            usercomment = decode_usercomment(usercomment)
            return {"usercomment": usercomment}

    return None


def parse_metadata(metadata: dict[str, Any]) -> ParsedMetadata:
    for parser in metadata_parsers:
        if parser.can_handle(metadata):
            return parser.parse(metadata)

    return ParsedMetadata(
        type="unknown",
        parse_error="No suitable parser found for the image metadata.",
    )
