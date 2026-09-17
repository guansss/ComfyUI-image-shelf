from __future__ import annotations

import gzip
import io
import json
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

from PIL import ExifTags, Image, TiffTags

from ..error import NotRecognizedError

# ============================================================================
# Configuration
# ============================================================================

SOFTWARE_PREFIX = "ComfyUI-Image-Shelf"

FORMAT_VERSION = 1

STORAGE_USERCOMMENT = "comment"
STORAGE_APP15 = "app15"

ENCODING_UNICODE = "utf-16be"
ENCODING_GZIP = "gzip_utf-8"

# See "UserComment" section in the spec: https://www.cipa.jp/std/documents/e/DC-008-2012_E.pdf
USERCOMMENT_PREFIX_ASCII = b"ASCII\0\0\0"
USERCOMMENT_PREFIX_UNICODE = b"UNICODE\0"
USERCOMMENT_PREFIX_JIS = b"JIS\0\0\0\0\0"
USERCOMMENT_PREFIX_UNDEFINED = b"\0\0\0\0\0\0\0\0"

JPEG_SOI = b"\xff\xd8"
JPEG_APP15_MARKER = b"\xff\xef"

# JPEG marker segment length includes the 2-byte length field itself.
# Therefore the maximum segment payload is 65533 bytes.
MAX_JPEG_SEGMENT_PAYLOAD = 65533

# Use a little safety margin rather than the absolute maximum.
MAX_APP15_PAYLOAD = 65000

# Software is an EXIF ASCII field. Keep the header comfortably small.
MAX_SOFTWARE_LENGTH = 1000


# ============================================================================
# Version
# ============================================================================


@dataclass(frozen=True)
class ExtensionVersion:
    major: int
    minor: int
    patch: int

    def __str__(self) -> str:
        return f"{self.major}.{self.minor}.{self.patch}"


@dataclass(frozen=True)
class MetadataHeader:
    format_version: int
    extension_version: ExtensionVersion
    storage: str
    encoding: str
    size: int
    chunks: int


# ============================================================================
# Software header
# ============================================================================


def build_software_header(header: MetadataHeader) -> str:
    """
    Example:

        ComfyUI-Image-Shelf;v=1;ext=1.2.3;storage=app15;size=123456;chunks=2;encoding=gzip_utf-8
    """

    header_str = (
        f"{SOFTWARE_PREFIX}"
        f";v={FORMAT_VERSION}"
        f";ext={header.extension_version}"
        f";storage={header.storage}"
        f";size={header.size}"
        f";chunks={header.chunks}"
        f";encoding={header.encoding}"
    )

    if len(header_str.encode("ascii")) + 1 > MAX_SOFTWARE_LENGTH:
        raise ValueError("Software header is too large")

    return header_str


def parse_software_header(
    software: str,
) -> MetadataHeader:
    """
    Parse our Software field.

    Raises ValueError if this is not our metadata.
    """

    prefix = SOFTWARE_PREFIX

    if not software.startswith(prefix):
        raise NotRecognizedError("Not ComfyUI Image Shelf metadata")

    remainder = software[len(prefix) :]

    parts = remainder.split(";")

    try:
        values = {}

        for part in parts[1:]:
            key, value = part.split("=", 1)
            values[key] = value

        format_version = int(values["v"])
        ext = values["ext"]
        major, minor, patch = map(
            int,
            ext.split("."),
        )

        storage = values["storage"]
        encoding = values["encoding"]
        size = int(values["size"])
        chunks = int(values["chunks"])

    except (KeyError, ValueError) as e:
        raise ValueError("Malformed ComfyUI Image Shelf metadata") from e

    if storage not in (
        STORAGE_USERCOMMENT,
        STORAGE_APP15,
    ):
        raise ValueError(f"Unknown storage type: {storage}")

    if encoding not in (
        ENCODING_UNICODE,
        ENCODING_GZIP,
    ):
        raise ValueError(f"Unsupported encoding: {encoding}")

    if size < 0:
        raise ValueError("Invalid payload size")

    if chunks < 1:
        raise ValueError("Invalid chunk count")

    return MetadataHeader(
        format_version=format_version,
        extension_version=ExtensionVersion(
            major,
            minor,
            patch,
        ),
        storage=storage,
        encoding=encoding,
        size=size,
        chunks=chunks,
    )


# ============================================================================
# Codec
# ============================================================================


def encode_usercomment(
    value: str,
    encoding: str,
) -> bytes:
    if encoding == ENCODING_GZIP:
        prefix = USERCOMMENT_PREFIX_UNDEFINED
    elif encoding == ENCODING_UNICODE:
        prefix = USERCOMMENT_PREFIX_UNICODE
    else:
        raise ValueError(f"Unsupported encoding: {encoding}")

    return prefix + encode_value(value, encoding)


def decode_usercomment(
    usercomment: bytes,
    encoding: str | None = None,
) -> str:
    prefix = usercomment[:8]
    payload = usercomment[8:]

    if prefix == USERCOMMENT_PREFIX_UNICODE:
        if encoding and encoding != ENCODING_UNICODE:
            raise ValueError(
                f"Encoding mismatch: expected {ENCODING_UNICODE}, got {encoding}"
            )
        return payload.decode("utf-16be", errors="replace")
    elif prefix == USERCOMMENT_PREFIX_ASCII:
        return payload.decode("ascii", errors="replace")
    elif prefix == USERCOMMENT_PREFIX_JIS:
        return payload.decode("shift_jis", errors="replace")
    elif prefix == USERCOMMENT_PREFIX_UNDEFINED:
        if not encoding:
            raise ValueError(
                "Encoding must be specified for undefined usercomment prefix"
            )
        return decode_value(payload, encoding)

    raise ValueError(f"Unknown usercomment prefix: {prefix}")


def encode_value(
    value: str,
    encoding: str,
) -> bytes:
    if encoding == ENCODING_GZIP:
        return compress_value(value)
    elif encoding == ENCODING_UNICODE:
        return value.encode("utf-16be")
    else:
        raise ValueError(f"Unsupported encoding: {encoding}")


def decode_value(
    data: bytes,
    encoding: str,
) -> str:
    if encoding == ENCODING_GZIP:
        return decompress_value(data)
    elif encoding == ENCODING_UNICODE:
        return data.decode("utf-16be")
    else:
        raise ValueError(f"Unsupported encoding: {encoding}")


def compress_value(
    value: str,
) -> bytes:
    return gzip.compress(
        value.encode("utf-8"),
        compresslevel=9,
    )


def decompress_value(
    data: bytes,
) -> str:
    return gzip.decompress(data).decode("utf-8")


# ============================================================================
# JPEG APP15
# ============================================================================


def make_app15_segment(
    data: bytes,
) -> bytes:
    """
    Create one JPEG APP15 marker segment.

    The payload is exactly `data`.
    No custom header is added.
    """

    if len(data) > MAX_JPEG_SEGMENT_PAYLOAD:
        raise ValueError("APP15 payload exceeds JPEG segment limit")

    segment_length = len(data) + 2

    return JPEG_APP15_MARKER + segment_length.to_bytes(2, "big") + data


def split_payload(
    data: bytes,
    max_chunk_size: int = MAX_APP15_PAYLOAD,
) -> list[bytes]:
    """
    Split binary data into raw chunks.
    """

    if max_chunk_size <= 0:
        raise ValueError("Invalid chunk size")

    return [
        data[i : i + max_chunk_size]
        for i in range(
            0,
            len(data),
            max_chunk_size,
        )
    ]


def make_app15_segments(
    data: bytes,
) -> list[bytes]:
    chunks = split_payload(
        data,
        MAX_APP15_PAYLOAD,
    )

    return [make_app15_segment(chunk) for chunk in chunks]


# ============================================================================
# JPEG segment iteration
# ============================================================================


def iter_jpeg_segments(
    jpeg: bytes,
):
    """
    Iterate over JPEG marker segments before SOS.

    Yields:

        (marker, payload)

    where marker is the byte after FF.

    Stops at SOS because image entropy data follows it.
    """

    if not jpeg.startswith(JPEG_SOI):
        raise ValueError("Not a JPEG")

    pos = 2
    length = len(jpeg)

    while pos < length:
        if jpeg[pos] != 0xFF:
            raise ValueError(f"Invalid JPEG marker at offset {pos}")

        # Skip fill FF bytes.
        marker_pos = pos

        while marker_pos < length and jpeg[marker_pos] == 0xFF:
            marker_pos += 1

        if marker_pos >= length:
            raise ValueError("Truncated JPEG")

        marker = jpeg[marker_pos]
        pos = marker_pos + 1

        # Standalone markers.
        if marker in (
            0xD8,  # SOI
            0xD9,  # EOI
        ):
            yield marker, None

            if marker == 0xD9:
                return

            continue

        # Start of Scan: everything afterwards is compressed image data.
        if marker == 0xDA:
            yield marker, None
            return

        if pos + 2 > length:
            raise ValueError("Truncated JPEG segment")

        segment_length = int.from_bytes(
            jpeg[pos : pos + 2],
            "big",
        )

        if segment_length < 2:
            raise ValueError("Invalid JPEG segment length")

        end = pos + segment_length

        if end > length:
            raise ValueError("Truncated JPEG segment")

        payload = jpeg[pos + 2 : end]

        yield marker, payload

        pos = end


# ============================================================================
# APP15 extraction
# ============================================================================


def extract_app15_segments(
    jpeg: bytes,
    expected_chunks: int,
    expected_size: int,
) -> bytes:
    """
    Extract our APP15 data.

    Because the APP15 payload itself contains no header, the Software
    field tells us exactly how many chunks and bytes to expect.

    We require the APP15 segments to appear contiguously.

    This prevents unrelated APP15 segments elsewhere in the JPEG from
    accidentally becoming part of the metadata.
    """

    found = []

    in_run = False

    for marker, payload in iter_jpeg_segments(jpeg):
        if marker == 0xEF:
            if not in_run:
                # Start of an APP15 run.
                found = []
                in_run = True

            found.append(payload)

            if len(found) == expected_chunks:
                break

        elif in_run:
            # Our APP15 chunks must be contiguous.
            break

    if len(found) != expected_chunks:
        raise ValueError(
            f"Expected {expected_chunks} APP15 segments, found {len(found)}"
        )

    data = b"".join(found)

    if len(data) != expected_size:
        raise ValueError(
            f"APP15 payload size mismatch: expected {expected_size}, got {len(data)}"
        )

    return data


# ============================================================================
# APP15 injection
# ============================================================================


def inject_app15(
    jpeg: bytes,
    segments: list[bytes],
) -> bytes:
    """
    Insert APP15 segments immediately after SOI.
    """

    if not jpeg.startswith(JPEG_SOI):
        raise ValueError("Not a JPEG")

    return jpeg[:2] + b"".join(segments) + jpeg[2:]


# ============================================================================
# EXIF
# ============================================================================


def get_software(
    exif: Image.Exif,
) -> str | None:

    value = exif.get(ExifTags.Base.Software)

    if value is None:
        return None

    if isinstance(value, bytes):
        value = value.rstrip(b"\0").decode(
            "ascii",
            errors="strict",
        )

    return value.strip("\0")


def get_usercomment(
    exif: Image.Exif,
) -> bytes | None:

    value = exif.get(ExifTags.Base.UserComment)

    if value is None:
        exif_ifd = exif.get_ifd(ExifTags.IFD.Exif)
        value = exif_ifd.get(ExifTags.Base.UserComment) if exif_ifd else None

    if value is None:
        return None

    return bytes(value)


# ============================================================================
# JPEG writer
# ============================================================================


@contextmanager
def fix_pillow_exif_tag():
    """
    Fixes the Pillow library's handling of the UserComment tag when generating Exif.

    The UserComment is defined to have an UNDEFINED type in the Exif specification,
    but Pillow incorrectly set it to a BYTE type if its value is a bytes object.
    """
    tag_group = TiffTags.TAGS_V2_GROUPS[ExifTags.IFD.Exif]
    original_tag = tag_group.get(ExifTags.Base.UserComment)
    override_tag = TiffTags.TagInfo(
        ExifTags.Base.UserComment, "UserComment", TiffTags.UNDEFINED, 1
    )
    tag_group[ExifTags.Base.UserComment] = override_tag
    try:
        yield
    finally:
        if original_tag:
            tag_group[ExifTags.Base.UserComment] = original_tag
        else:
            tag_group.pop(ExifTags.Base.UserComment, None)


def save_jpeg_with_metadata(
    image: Image.Image,
    output_path: str,
    metadata: dict[str, Any],
    extension_version: ExtensionVersion,
    *,
    quality: int = 95,
) -> MetadataHeader:
    with fix_pillow_exif_tag():
        return _save_jpeg_with_metadata(
            image,
            output_path,
            metadata,
            extension_version,
            quality=quality,
        )


def _save_jpeg_with_metadata(
    image: Image.Image,
    output_path: str,
    metadata: dict[str, Any],
    extension_version: ExtensionVersion,
    *,
    quality: int = 95,
) -> MetadataHeader:
    """
    Save JPEG with embedded metadata.

    Small payload:
        EXIF Software + EXIF UserComment

    Large payload:
        EXIF Software + APP15 chunks
    """

    metadata_str = json.dumps(metadata, separators=(",", ":"))

    exif = image.getexif()

    # First determine whether the compressed metadata can fit into
    # UserComment.
    #
    # We use the actual exif output to determine this rather than
    # guessing from the UserComment field alone.
    #
    # Build EXIF with a provisional Software field first.
    #
    # The header itself needs to know the final storage and size.

    # ------------------------------------------------------------------
    # Try UserComment storage
    # ------------------------------------------------------------------

    def try_comment_storage(encoding: str) -> MetadataHeader | None:
        usercomment = encode_usercomment(metadata_str, encoding)

        header = MetadataHeader(
            format_version=FORMAT_VERSION,
            extension_version=extension_version,
            storage=STORAGE_USERCOMMENT,
            encoding=encoding,
            size=len(usercomment),
            chunks=1,
        )

        inline_header = build_software_header(header)

        exif[ExifTags.Base.Software] = inline_header.encode("ascii") + b"\0"

        exif_ifd = exif.get_ifd(ExifTags.IFD.Exif)
        exif_ifd[ExifTags.Base.UserComment] = usercomment

        exif_bytes = exif.tobytes()

        # A JPEG APP1 segment can contain at most 65533 bytes of payload.
        inline_fits = len(exif_bytes) <= MAX_JPEG_SEGMENT_PAYLOAD

        if inline_fits:
            image.save(
                output_path,
                format="JPEG",
                quality=quality,
                exif=exif_bytes,
            )

            return header

        # Clean up the provisional UserComment field if it didn't fit.
        del exif_ifd[ExifTags.Base.UserComment]

    for encoding in [ENCODING_UNICODE, ENCODING_GZIP]:
        header = try_comment_storage(encoding)
        if header:
            return header

    # ------------------------------------------------------------------
    # APP15 storage
    # ------------------------------------------------------------------

    payload = encode_value(metadata_str, ENCODING_GZIP)
    chunks = split_payload(payload, MAX_APP15_PAYLOAD)

    header = MetadataHeader(
        format_version=FORMAT_VERSION,
        extension_version=extension_version,
        storage=STORAGE_APP15,
        encoding=ENCODING_GZIP,
        size=len(payload),
        chunks=len(chunks),
    )

    app15_header = build_software_header(header)

    exif[ExifTags.Base.Software] = app15_header.encode("ascii") + b"\0"
    exif_bytes = exif.tobytes()

    # Encode JPEG first.
    buffer = io.BytesIO()

    image.save(
        buffer,
        format="JPEG",
        quality=quality,
        exif=exif_bytes,
    )

    jpeg = buffer.getvalue()

    # Inject raw metadata chunks.
    segments = [make_app15_segment(chunk) for chunk in chunks]

    jpeg = inject_app15(jpeg, segments)

    with open(output_path, "wb") as f:
        f.write(jpeg)

    return header


# ============================================================================
# JPEG reader
# ============================================================================


def read_jpeg_metadata(
    image: Image.Image,
    raw: bytes,
) -> tuple[dict[str, Any], MetadataHeader]:
    """
    Read metadata from a JPEG.

    The Software tag tells us where the payload lives.
    """

    exif = image.getexif()

    software = get_software(exif)

    if software is None:
        raise NotRecognizedError("JPEG does not contain ComfyUI Image Shelf metadata")

    header = parse_software_header(software)

    if header.storage == STORAGE_USERCOMMENT:
        data = get_usercomment(exif)

        if data is None:
            raise ValueError(
                "Metadata says UserComment storage, but UserComment is missing"
            )

        if len(data) != header.size:
            raise ValueError(
                f"UserComment size mismatch: expected {header.size}, got {len(data)}"
            )

        metadata_str = decode_usercomment(data, header.encoding)

    elif header.storage == STORAGE_APP15:
        data = extract_app15_segments(
            raw,
            header.chunks,
            header.size,
        )
        metadata_str = decode_value(data, header.encoding)

    else:
        raise ValueError(f"Unsupported storage: {header.storage}")

    try:
        metadata = json.loads(metadata_str)
    except json.JSONDecodeError as e:
        raise ValueError("Failed to decode metadata as JSON") from e

    return metadata, header
