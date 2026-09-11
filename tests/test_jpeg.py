import base64
import random
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path

from PIL import ExifTags, Image

from image_shelf.utils.jpeg import (
    ENCODING_GZIP,
    ENCODING_UNICODE,
    FORMAT_VERSION,
    JPEG_APP15_MARKER,
    MAX_APP15_PAYLOAD,
    STORAGE_APP15,
    STORAGE_USERCOMMENT,
    ExtensionVersion,
    MetadataHeader,
    build_software_header,
    decode_usercomment,
    decode_value,
    encode_usercomment,
    encode_value,
    extract_app15_segments,
    get_exif,
    get_software,
    get_usercomment,
    inject_app15,
    iter_jpeg_segments,
    make_app15_segment,
    make_app15_segments,
    parse_software_header,
    read_jpeg_workflow,
    save_jpeg_with_workflow,
    split_payload,
)


class JpegHeaderTests(unittest.TestCase):
    def test_software_header_round_trips(self) -> None:
        header = MetadataHeader(
            FORMAT_VERSION,
            ExtensionVersion(1, 2, 3),
            STORAGE_APP15,
            ENCODING_GZIP,
            123456,
            2,
        )

        parsed = parse_software_header(build_software_header(header))

        self.assertEqual(parsed, header)

    def test_parse_software_header_rejects_unknown_storage(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unknown storage type"):
            parse_software_header(
                "ComfyUI-Image-Shelf;v=1;ext=1.0.0;storage=unknown;"
                "size=1;chunks=1;encoding=gzip_utf-8"
            )


class WorkflowCodecTests(unittest.TestCase):
    def test_unicode_and_gzip_codecs_round_trip(self) -> None:
        workflow = '{"prompt": "日本語", "steps": 20}'

        for encoding in (ENCODING_UNICODE, ENCODING_GZIP):
            with self.subTest(encoding=encoding):
                encoded = encode_value(workflow, encoding)
                self.assertEqual(decode_value(encoded, encoding), workflow)

    def test_codecs_reject_unknown_encoding(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unsupported encoding"):
            encode_value("workflow", "unknown")

        with self.assertRaisesRegex(ValueError, "Unsupported encoding"):
            decode_value(b"workflow", "unknown")


class JpegSegmentTests(unittest.TestCase):
    def test_split_payload_and_make_segments_preserve_data(self) -> None:
        data = bytes(range(256)) * 300

        chunks = split_payload(data, 1000)
        segments = make_app15_segments(data)

        self.assertEqual(b"".join(chunks), data)
        self.assertTrue(
            all(segment.startswith(JPEG_APP15_MARKER) for segment in segments)
        )
        self.assertEqual(
            b"".join(
                payload
                for marker, payload in iter_jpeg_segments(
                    b"\xff\xd8" + b"".join(segments) + b"\xff\xda"
                )
                if marker == 0xEF
            ),
            data,
        )

    def test_extract_app15_segments_requires_contiguous_chunks(self) -> None:
        first = make_app15_segment(b"first")
        second = make_app15_segment(b"second")
        jpeg = b"\xff\xd8" + first + b"\xff\xe1\x00\x02" + second + b"\xff\xda"

        with self.assertRaisesRegex(ValueError, "Expected 2 APP15 segments"):
            extract_app15_segments(jpeg, expected_chunks=2, expected_size=11)

    def test_inject_app15_places_segments_after_soi(self) -> None:
        segment = make_app15_segment(b"workflow")
        jpeg = inject_app15(b"\xff\xd8\xff\xda", [segment])

        self.assertEqual(jpeg[:2], b"\xff\xd8")
        self.assertEqual(jpeg[2 : 2 + len(segment)], segment)


class JpegExifTests(unittest.TestCase):
    def test_exif_helpers_read_software_and_usercomment(self) -> None:
        image = Image.new("RGB", (4, 4), "white")
        exif = get_exif(image)
        exif[ExifTags.Base.Software] = b"ComfyUI-Image-Shelf\0"
        exif[ExifTags.Base.UserComment] = b"workflow"

        self.assertEqual(get_software(exif), "ComfyUI-Image-Shelf")
        self.assertEqual(get_usercomment(exif), b"workflow")

    def test_exif_usercomment_round_trip(self) -> None:
        usercomment = encode_usercomment("workflow", ENCODING_UNICODE)
        self.assertEqual(decode_usercomment(usercomment), "workflow")

        usercomment = encode_usercomment("workflow", ENCODING_GZIP)
        self.assertEqual(decode_usercomment(usercomment, ENCODING_GZIP), "workflow")


class JpegWorkflowTests(unittest.TestCase):
    def test_small_workflow_round_trip_uses_usercomment(self) -> None:
        workflow = '{"nodes": [{"type": "KSampler"}], "text": "日本語"}'
        image = Image.new("RGB", (8, 8), "white")

        with self.subTest(storage=STORAGE_USERCOMMENT):
            with self._saved_jpeg(image, workflow) as (jpeg, header):
                self.assertEqual(header.storage, STORAGE_USERCOMMENT)
                self.assertEqual(read_jpeg_workflow(image, jpeg), (workflow, header))

    def test_large_workflow_round_trip_uses_app15(self) -> None:
        generator = random.Random(0)
        random_bytes = bytes(generator.getrandbits(8) for _ in range(80000))
        workflow_data = base64.b64encode(random_bytes).decode("ascii")
        workflow = '{"workflow": "' + workflow_data + '"}'
        image = Image.new("RGB", (8, 8), "white")

        with self._saved_jpeg(image, workflow) as (jpeg, header):
            self.assertEqual(header.storage, STORAGE_APP15)
            self.assertGreater(header.chunks, 1)
            self.assertGreater(header.size, MAX_APP15_PAYLOAD)
            self.assertEqual(read_jpeg_workflow(image, jpeg), (workflow, header))

    @staticmethod
    @contextmanager
    def _saved_jpeg(image: Image.Image, workflow: str):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_path = Path(temporary_directory) / "workflow.jpg"
            header = save_jpeg_with_workflow(
                image,
                str(output_path),
                workflow,
                ExtensionVersion(1, 0, 0),
            )
            yield output_path.read_bytes(), header


if __name__ == "__main__":
    unittest.main()
