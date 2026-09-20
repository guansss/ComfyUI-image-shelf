import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from aiohttp import web

from image_shelf.api import GalleryApi, _development_cors_middleware
from image_shelf.configuration import ShelfSettings
from image_shelf.indexer import IndexingResult
from image_shelf.models import GalleryFolder


class GalleryApiIndexingEventsTests(unittest.IsolatedAsyncioTestCase):
    async def test_reindex_passes_force_option_to_indexing_task(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            folder = Path(temporary_directory)
            api = GalleryApi(None, None)  # pyrefly: ignore [bad-argument-type]
            api.folders = (GalleryFolder("folder-1", "First", folder),)
            api._create_indexing_task = Mock()
            request = Mock(query={"folder": "folder-1", "force": "true"})

            response = await api.reindex(request)

            self.assertEqual(response.status, 202)
            api._create_indexing_task.assert_called_once_with(folder, True)

    async def test_broadcasts_index_events_for_each_tab_sharing_a_folder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            folder = Path(temporary_directory)
            api = GalleryApi(None, None)  # pyrefly: ignore [bad-argument-type]
            api.folders = (
                GalleryFolder("folder-1", "First", folder),
                GalleryFolder("folder-2", "Second", folder),
            )
            websocket = Mock()
            websocket.send_json = AsyncMock()
            api.websocket_clients.add(websocket)
            api.indexer.index_folder = AsyncMock(
                return_value=IndexingResult(2, 1, 0, 0)
            )

            result = await api._index_folder_and_broadcast(folder)

            self.assertEqual(result, IndexingResult(2, 1, 0, 0))
            self.assertEqual(
                [call.args[0] for call in websocket.send_json.await_args_list],
                [
                    {"event": "indexStart", "data": {"folder": "folder-1"}},
                    {"event": "indexStart", "data": {"folder": "folder-2"}},
                    {
                        "event": "indexFinish",
                        "data": {
                            "folder": "folder-1",
                            "result": {
                                "indexed": 2,
                                "skipped": 1,
                                "removed": 0,
                                "errors": 0,
                            },
                        },
                    },
                    {
                        "event": "indexFinish",
                        "data": {
                            "folder": "folder-2",
                            "result": {
                                "indexed": 2,
                                "skipped": 1,
                                "removed": 0,
                                "errors": 0,
                            },
                        },
                    },
                ],
            )

    async def test_broadcasts_index_error(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            folder = Path(temporary_directory)
            api = GalleryApi(None, None)  # pyrefly: ignore [bad-argument-type]
            api.folders = (GalleryFolder("folder-1", "First", folder),)
            websocket = Mock()
            websocket.send_json = AsyncMock()
            api.websocket_clients.add(websocket)
            api.indexer.index_folder = AsyncMock(side_effect=RuntimeError("failed"))

            with self.assertRaisesRegex(RuntimeError, "failed"):
                await api._index_folder_and_broadcast(folder)

            self.assertEqual(
                [call.args[0] for call in websocket.send_json.await_args_list],
                [
                    {"event": "indexStart", "data": {"folder": "folder-1"}},
                    {
                        "event": "indexFinish",
                        "data": {"folder": "folder-1", "error": "failed"},
                    },
                ],
            )


class GalleryApiTransferTests(unittest.IsolatedAsyncioTestCase):
    async def test_transfers_image_to_selected_folder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source_folder = root / "source"
            target_folder = root / "target"
            source_folder.mkdir()
            target_folder.mkdir()
            source = source_folder / "image.png"
            source.write_bytes(b"image")

            repository = Mock()
            repository.path_for_public_id.return_value = source
            api = GalleryApi(repository, None)  # pyrefly: ignore [bad-argument-type]
            api.folders = (
                GalleryFolder("source", "Source", source_folder),
                GalleryFolder("target", "Target", target_folder),
            )
            request = Mock(match_info={"image_id": "image-id"})
            request.json = AsyncMock(
                return_value={"folder": "target", "mode": "copy"}
            )

            response = await api.transfer_image(request)

            self.assertEqual(response.status, 201)
            self.assertEqual(
                json.loads(response.text or ""),
                {"folder": "target", "filename": "image.png", "mode": "copy"},
            )
            self.assertTrue(source.is_file())
            self.assertTrue((target_folder / "image.png").is_file())

    async def test_rejects_unknown_target_folder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "image.png"
            source.write_bytes(b"image")
            repository = Mock()
            repository.path_for_public_id.return_value = source
            api = GalleryApi(repository, None)  # pyrefly: ignore [bad-argument-type]
            api.folders = (GalleryFolder("outputs", "Outputs", root),)
            request = Mock(match_info={"image_id": "image-id"})
            request.json = AsyncMock(return_value={"folder": "missing"})

            with self.assertRaises(web.HTTPNotFound):
                await api.transfer_image(request)

    async def test_rejects_missing_target_folder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "image.png"
            source.write_bytes(b"image")
            target = root / "missing"
            repository = Mock()
            repository.path_for_public_id.return_value = source
            api = GalleryApi(repository, None)  # pyrefly: ignore [bad-argument-type]
            api.folders = (GalleryFolder("target", "Target", target),)
            request = Mock(match_info={"image_id": "image-id"})
            request.json = AsyncMock(return_value={"folder": "target"})

            with self.assertRaises(web.HTTPNotFound):
                await api.transfer_image(request)

    async def test_rejects_image_already_in_target_folder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            folder = Path(temporary_directory)
            source = folder / "image.png"
            source.write_bytes(b"image")
            repository = Mock()
            repository.path_for_public_id.return_value = source
            api = GalleryApi(repository, None)  # pyrefly: ignore [bad-argument-type]
            api.folders = (GalleryFolder("target", "Target", folder),)
            request = Mock(match_info={"image_id": "image-id"})
            request.json = AsyncMock(return_value={"folder": "target"})

            with self.assertRaises(web.HTTPBadRequest):
                await api.transfer_image(request)

    async def test_transfers_multiple_images_to_selected_folder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source_folder = root / "source"
            target_folder = root / "target"
            source_folder.mkdir()
            target_folder.mkdir()
            sources = {
                "first": source_folder / "first.png",
                "second": source_folder / "second.png",
            }
            sources["first"].write_bytes(b"first")
            sources["second"].write_bytes(b"second")

            repository = Mock()
            repository.path_for_public_id.side_effect = sources.get
            api = GalleryApi(repository, None)  # pyrefly: ignore [bad-argument-type]
            api.folders = (
                GalleryFolder("source", "Source", source_folder),
                GalleryFolder("target", "Target", target_folder),
            )
            request = Mock()
            request.json = AsyncMock(
                return_value={
                    "image_ids": ["first", "second"],
                    "folder": "target",
                    "mode": "copy",
                    "conflict": "fail",
                }
            )

            response = await api.transfer_images(request)

            self.assertEqual(response.status, 201)
            self.assertEqual(
                json.loads(response.text or ""),
                {
                    "folder": "target",
                    "mode": "copy",
                    "items": [
                        {"image_id": "first", "filename": "first.png"},
                        {"image_id": "second", "filename": "second.png"},
                    ],
                },
            )

    async def test_batch_suggest_returns_all_conflicts_without_transfer(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source_folder = root / "source"
            target_folder = root / "target"
            source_folder.mkdir()
            target_folder.mkdir()
            first = source_folder / "first.png"
            second = source_folder / "second.png"
            first.write_bytes(b"first")
            second.write_bytes(b"second")
            (target_folder / "first.png").write_bytes(b"existing first")
            (target_folder / "second.png").write_bytes(b"existing second")

            repository = Mock()
            repository.path_for_public_id.side_effect = {
                "first-id": first,
                "second-id": second,
            }.get
            api = GalleryApi(repository, None)  # pyrefly: ignore [bad-argument-type]
            api.folders = (
                GalleryFolder("source", "Source", source_folder),
                GalleryFolder("target", "Target", target_folder),
            )
            request = Mock()
            request.json = AsyncMock(
                return_value={
                    "image_ids": ["first-id", "second-id"],
                    "folder": "target",
                    "mode": "move",
                    "conflict": "suggest",
                }
            )

            response = await api.transfer_images(request)

            self.assertEqual(response.status, 409)
            self.assertEqual(
                json.loads(response.text or ""),
                {
                    "error": "filename_conflicts",
                    "conflicts": [
                        {
                            "image_id": "first-id",
                            "filename": "first.png",
                            "suggested_filename": "first_1.png",
                        },
                        {
                            "image_id": "second-id",
                            "filename": "second.png",
                            "suggested_filename": "second_1.png",
                        },
                    ],
                },
            )
            self.assertTrue(first.exists())
            self.assertTrue(second.exists())

    async def test_transfers_comfy_assets_using_output_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            output = root / "output"
            target = root / "target"
            output.mkdir()
            target.mkdir()
            source = output / "nested" / "image.png"
            source.parent.mkdir()
            source.write_bytes(b"image")
            folder_paths = SimpleNamespace(
                annotated_filepath=Mock(return_value=("image.png", None)),
                get_directory_by_type=Mock(return_value=str(output)),
            )
            api = GalleryApi(None, None)  # pyrefly: ignore [bad-argument-type]
            api.folders = (GalleryFolder("target", "Target", target),)
            request = Mock()
            request.json = AsyncMock(
                return_value={
                    "items": [{"filename": "image.png", "subfolder": "nested"}],
                    "folder": "target",
                }
            )

            with patch.dict(sys.modules, {"folder_paths": folder_paths}):
                response = await api.transfer_assets(request)

            self.assertEqual(response.status, 201)
            self.assertEqual(
                json.loads(response.text or ""),
                {
                    "folder": "target",
                    "mode": "copy",
                    "items": [
                        {
                            "item": {"filename": "image.png", "subfolder": "nested"},
                            "filename": "image.png",
                        }
                    ],
                },
            )
            self.assertTrue(source.is_file())
            self.assertTrue((target / "image.png").is_file())
            folder_paths.annotated_filepath.assert_called_once_with("image.png")
            folder_paths.get_directory_by_type.assert_called_once_with("output")

    async def test_rejects_comfy_asset_path_escape(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            output = root / "output"
            target = root / "target"
            output.mkdir()
            target.mkdir()
            folder_paths = SimpleNamespace(
                annotated_filepath=Mock(return_value=("image.png", None)),
                get_directory_by_type=Mock(return_value=str(output)),
            )
            api = GalleryApi(None, None)  # pyrefly: ignore [bad-argument-type]
            api.folders = (GalleryFolder("target", "Target", target),)
            request = Mock()
            request.json = AsyncMock(
                return_value={
                    "items": [{"filename": "image.png", "subfolder": ".."}],
                    "folder": "target",
                }
            )

            with patch.dict(sys.modules, {"folder_paths": folder_paths}):
                with self.assertRaises(web.HTTPBadRequest):
                    await api.transfer_assets(request)

class DevelopmentCorsMiddlewareTests(unittest.IsolatedAsyncioTestCase):
    async def test_adds_cors_headers_to_http_errors(self) -> None:
        request = Mock(method="GET", headers={"Origin": "http://localhost:8188"})
        handler = AsyncMock(side_effect=web.HTTPBadRequest(text="invalid request"))

        response = await _development_cors_middleware(request, handler)

        self.assertEqual(response.status, 400)
        self.assertEqual(
            response.headers["Access-Control-Allow-Origin"],
            "http://localhost:8188",
        )


class GalleryApiSettingsTests(unittest.IsolatedAsyncioTestCase):
    async def test_settings_are_read_and_updated_through_the_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            settings = ShelfSettings(root, root / "settings.json")
            api = GalleryApi(None, settings)  # pyrefly: ignore [bad-argument-type]
            api.apply_settings = AsyncMock()
            await api.get_settings(Mock())

            new_settings = {
                "custom_folders": [
                    {"id": "folder-1", "name": "Custom", "path": str(root / "custom")}
                ]
            }
            request = Mock()
            request.json = AsyncMock(return_value=new_settings)
            response = await api.update_settings(request)

            self.assertEqual(response.status, 200)
            api.apply_settings.assert_awaited_once()
            self.assertEqual(
                json.loads((Path(temporary_directory) / "settings.json").read_text()),
                new_settings,
            )


if __name__ == "__main__":
    unittest.main()
