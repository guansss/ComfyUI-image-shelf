import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock, Mock, patch

from aiohttp import web

from image_shelf.api import GalleryApi, _development_cors_middleware
from image_shelf.configuration import ShelfSettings
from image_shelf.database import ImageRepository
from image_shelf.indexer import IndexingResult
from image_shelf.models import GalleryFolder
from image_shelf.watcher import FolderWatcher

ASSETS = Path(__file__).parent / "assets"


class GalleryApiMetadataTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def _workflow_body() -> dict[str, Any]:
        body: dict[str, Any] = {}
        for key, filename in (
            ("api_workflow", "api-workflow.json"),
            ("ui_workflow", "ui-workflow.json"),
        ):
            with open(ASSETS / filename, encoding="utf-8") as workflow_file:
                body[key] = json.load(workflow_file)
        return body

    @staticmethod
    def _request(body: Any) -> Mock:
        request = Mock()
        request.json = AsyncMock(return_value=body)
        return request

    async def _parse(self, api: GalleryApi, body: Any) -> dict[str, Any]:
        response = await api.parse_workflow_metadata(self._request(body))
        self.assertEqual(response.status, 200)
        return json.loads(response.text or "")

    async def test_registers_parse_workflow_endpoint(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            api = GalleryApi(
                cast(ImageRepository, None),
                ShelfSettings(root, root / "settings.json"),
            )
            app = web.Application()

            api.register(app, register_startup=False)

            self.assertIn(
                "/api/image-shelf/v1/metadata/parse-workflow",
                {resource.canonical for resource in app.router.resources()},
            )

    async def test_parses_api_and_ui_workflow_pair(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            api = GalleryApi(
                cast(ImageRepository, None),
                ShelfSettings(root, root / "settings.json"),
            )
            workflows = self._workflow_body()

            result = await self._parse(api, workflows)

            self.assertEqual(result["type"], "comfy")
            self.assertIsNone(result["parse_error"])
            self.assertEqual(result["tags"], ["best quality"])
            self.assertEqual(result["negative_tags"], ["lowres"])
            self.assertEqual(result["info"]["prompt"], workflows["api_workflow"])
            self.assertEqual(result["info"]["workflow"], workflows["ui_workflow"])

    async def test_request_hints_override_saved_hints(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            settings = ShelfSettings(root, root / "settings.json")
            settings.update(
                {
                    "prompt_hints": [
                        {
                            "id": "force-positive",
                            "class_type": "CLIPTextEncode",
                            "input_name": "text",
                            "role": "positive",
                        }
                    ]
                }
            )
            api = GalleryApi(None, settings)  # pyrefly: ignore [bad-argument-type]
            workflows = self._workflow_body()

            saved_hint_result = await self._parse(api, workflows)
            request_hint_result = await self._parse(
                api,
                {
                    **workflows,
                    "hints": [
                        {
                            "id": "force-negative",
                            "class_type": "CLIPTextEncode",
                            "input_name": "text",
                            "role": "negative",
                        }
                    ],
                },
            )
            empty_hint_result = await self._parse(
                api,
                {
                    **workflows,
                    "hints": [],
                },
            )

            self.assertIn("lowres", saved_hint_result["tags"])
            self.assertEqual(saved_hint_result["negative_tags"], [])
            self.assertIn("lowres", request_hint_result["negative_tags"])
            self.assertNotIn("lowres", request_hint_result["tags"])
            self.assertEqual(empty_hint_result["tags"], ["best quality"])
            self.assertEqual(empty_hint_result["negative_tags"], ["lowres"])

    async def test_rejects_invalid_workflow_and_hint_requests(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            api = GalleryApi(
                cast(ImageRepository, None),
                ShelfSettings(root, root / "settings.json"),
            )
            invalid_bodies = (
                [],
                {"ui_workflow": {}},
                {"api_workflow": {}, "ui_workflow": []},
                {"api_workflow": {}, "ui_workflow": {}, "hints": {}},
                {"api_workflow": {}, "ui_workflow": {}, "hints": [{"id": "bad"}]},
            )

            for body in invalid_bodies:
                with self.subTest(body=body):
                    with self.assertRaises(web.HTTPBadRequest):
                        await api.parse_workflow_metadata(self._request(body))


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

            async def index_folder(
                indexed_folder: Path, force: bool = False, progress_callback=None
            ) -> IndexingResult:
                assert progress_callback is not None
                await asyncio.to_thread(progress_callback, 0, 101)
                await asyncio.to_thread(progress_callback, 100, 101)
                await asyncio.to_thread(progress_callback, 101, 101)
                return IndexingResult(2, 1, 0, 0)

            api.indexer.index_folder = AsyncMock(side_effect=index_folder)

            result = await api._index_folder_and_broadcast(folder)

            self.assertEqual(result, IndexingResult(2, 1, 0, 0))
            self.assertEqual(
                [call.args[0] for call in websocket.send_json.await_args_list],
                [
                    {"event": "indexStart", "data": {"folder": "folder-1"}},
                    {"event": "indexStart", "data": {"folder": "folder-2"}},
                    {
                        "event": "indexProgress",
                        "data": {
                            "folder": "folder-1",
                            "processed": 0,
                            "total": 101,
                        },
                    },
                    {
                        "event": "indexProgress",
                        "data": {
                            "folder": "folder-2",
                            "processed": 0,
                            "total": 101,
                        },
                    },
                    {
                        "event": "indexProgress",
                        "data": {
                            "folder": "folder-1",
                            "processed": 100,
                            "total": 101,
                        },
                    },
                    {
                        "event": "indexProgress",
                        "data": {
                            "folder": "folder-2",
                            "processed": 100,
                            "total": 101,
                        },
                    },
                    {
                        "event": "indexProgress",
                        "data": {
                            "folder": "folder-1",
                            "processed": 101,
                            "total": 101,
                        },
                    },
                    {
                        "event": "indexProgress",
                        "data": {
                            "folder": "folder-2",
                            "processed": 101,
                            "total": 101,
                        },
                    },
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

            async def index_folder(
                indexed_folder: Path, force: bool = False, progress_callback=None
            ) -> IndexingResult:
                assert progress_callback is not None
                await asyncio.to_thread(progress_callback, 0, 101)
                raise RuntimeError("failed")

            api.indexer.index_folder = AsyncMock(side_effect=index_folder)

            with self.assertRaisesRegex(RuntimeError, "failed"):
                await api._index_folder_and_broadcast(folder)

            self.assertEqual(
                [call.args[0] for call in websocket.send_json.await_args_list],
                [
                    {"event": "indexStart", "data": {"folder": "folder-1"}},
                    {
                        "event": "indexProgress",
                        "data": {
                            "folder": "folder-1",
                            "processed": 0,
                            "total": 101,
                        },
                    },
                    {
                        "event": "indexFinish",
                        "data": {"folder": "folder-1", "error": "failed"},
                    },
                ],
            )

    async def test_watcher_indexing_records_and_broadcasts_errors(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            folder = Path(temporary_directory)
            api = GalleryApi(None, None)  # pyrefly: ignore [bad-argument-type]
            api.folders = (GalleryFolder("folder-1", "First", folder),)
            websocket = Mock()
            websocket.send_json = AsyncMock()
            api.websocket_clients.add(websocket)
            api.indexer.index_folder = AsyncMock(side_effect=RuntimeError("failed"))
            watcher = FolderWatcher(api._ensure_indexing_task, asyncio.get_running_loop())

            watcher._submit_index(folder)
            await asyncio.sleep(0)
            task = api.indexing_tasks[folder]
            with self.assertRaisesRegex(RuntimeError, "failed"):
                await task
            await asyncio.sleep(0)

            self.assertEqual(str(api.indexing_errors[folder]), "failed")
            self.assertIn(
                {
                    "event": "indexFinish",
                    "data": {"folder": "folder-1", "error": "failed"},
                },
                [call.args[0] for call in websocket.send_json.await_args_list],
            )


class GalleryApiRevealTests(unittest.IsolatedAsyncioTestCase):
    async def test_reveal_image_ignores_windows_explorer_exit_code(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            image = root / "image.png"
            image.write_bytes(b"image")
            repository = Mock()
            repository.path_for_public_id.return_value = image
            api = GalleryApi(repository, None)  # pyrefly: ignore [bad-argument-type]
            api.folders = (GalleryFolder("outputs", "Outputs", root),)
            request = Mock(match_info={"image_id": "image-id"})

            with patch("image_shelf.api.sys.platform", "win32"), patch(
                "image_shelf.api.subprocess.run",
                return_value=SimpleNamespace(returncode=1),
            ) as run:
                response = await api.reveal_image(request)

            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.text or ""), {"accepted": True})
            run.assert_called_once_with(
                ["explorer", "/select,", str(image)], check=False
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
            request.json = AsyncMock(return_value={"folder": "target", "mode": "copy"})

            response = await api.transfer_image(request)

            self.assertEqual(response.status, 201)
            self.assertEqual(
                json.loads(response.text or ""),
                {"folder": "target", "filename": "image.png", "mode": "copy"},
            )
            self.assertTrue(source.is_file())
            self.assertTrue((target_folder / "image.png").is_file())

    async def test_moves_image_from_nested_folder_to_parent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source_folder = root / "nested"
            source_folder.mkdir()
            source = source_folder / "image.png"
            source.write_bytes(b"image")

            repository = Mock()
            repository.path_for_public_id.return_value = source
            api = GalleryApi(repository, None)  # pyrefly: ignore [bad-argument-type]
            api.folders = (
                GalleryFolder("source", "Source", source_folder),
                GalleryFolder("target", "Target", root),
            )
            request = Mock(match_info={"image_id": "image-id"})
            request.json = AsyncMock(
                return_value={"folder": "target", "mode": "move"}
            )

            response = await api.transfer_image(request)

            self.assertEqual(response.status, 201)
            self.assertFalse(source.exists())
            self.assertTrue((root / "image.png").is_file())

    async def test_batch_moves_image_from_nested_folder_to_parent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source_folder = root / "nested"
            source_folder.mkdir()
            source = source_folder / "image.png"
            source.write_bytes(b"image")

            repository = Mock()
            repository.path_for_public_id.return_value = source
            api = GalleryApi(repository, None)  # pyrefly: ignore [bad-argument-type]
            api.folders = (
                GalleryFolder("source", "Source", source_folder),
                GalleryFolder("target", "Target", root),
            )
            request = Mock()
            request.json = AsyncMock(
                return_value={
                    "image_ids": ["image-id"],
                    "folder": "target",
                    "mode": "move",
                }
            )

            response = await api.transfer_images(request)

            self.assertEqual(response.status, 201)
            self.assertFalse(source.exists())
            self.assertTrue((root / "image.png").is_file())

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

    async def test_transfers_comfy_assets_with_custom_filenames(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            output = root / "output"
            target = root / "target"
            output.mkdir()
            target.mkdir()
            source = output / "image.png"
            source.write_bytes(b"image")
            (target / "image.png").write_bytes(b"existing image")
            item = {"filename": "image.png"}
            folder_paths = SimpleNamespace(
                annotated_filepath=Mock(return_value=("image.png", None)),
                get_directory_by_type=Mock(return_value=str(output)),
            )
            api = GalleryApi(None, None)  # pyrefly: ignore [bad-argument-type]
            api.folders = (GalleryFolder("target", "Target", target),)
            request = Mock()
            request.json = AsyncMock(
                side_effect=[
                    {"items": [item], "folder": "target"},
                    {
                        "items": [item],
                        "folder": "target",
                        "filenames": {"0": "renamed.png"},
                    },
                ]
            )

            with patch.dict(sys.modules, {"folder_paths": folder_paths}):
                conflict_response = await api.transfer_assets(request)
                response = await api.transfer_assets(request)

            self.assertEqual(conflict_response.status, 409)
            self.assertEqual(
                json.loads(conflict_response.text or "")["conflicts"],
                [
                    {
                        "index": 0,
                        "filename": "image.png",
                        "suggested_filename": "image_1.png",
                    }
                ],
            )
            self.assertEqual(response.status, 201)
            self.assertEqual(
                json.loads(response.text or "")["items"],
                [{"item": item, "filename": "renamed.png"}],
            )
            self.assertEqual(source.read_bytes(), b"image")
            self.assertEqual((target / "image.png").read_bytes(), b"existing image")
            self.assertEqual((target / "renamed.png").read_bytes(), b"image")

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
    async def test_app_info_returns_database_and_settings_file_details(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            database_path = root / "image-shelf.sqlite3"
            settings_path = root / "settings.json"
            settings = ShelfSettings(root, settings_path)
            repository = ImageRepository(database_path)
            api = GalleryApi(repository, settings, root / "cache")

            response = await api.app_info(Mock())

            self.assertEqual(response.status, 200)
            body = response.body
            self.assertIsInstance(body, (str, bytes, bytearray))
            self.assertEqual(
                json.loads(body),
                {
                    "database_path": str(database_path),
                    "database_size": database_path.stat().st_size,
                    "settings_path": str(settings_path),
                    "thumbnail_cache": {
                        "bytes": 0,
                        "files": 0,
                        "max_bytes": 2 * 1024 * 1024 * 1024,
                    },
                },
            )
            repository.close()

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
                ],
                "prompt_hints": [
                    {
                        "id": "custom-text",
                        "class_type": "CustomPrompt",
                        "kind": "text",
                        "input_name": "prompt",
                        "role": "positive",
                        "ignore": False,
                    }
                ],
            }
            request = Mock()
            request.json = AsyncMock(return_value=new_settings)
            response = await api.update_settings(request)

            self.assertEqual(response.status, 200)
            api.apply_settings.assert_awaited_once()
            self.assertEqual(
                json.loads((Path(temporary_directory) / "settings.json").read_text()),
                {
                    **new_settings,
                    "thumbnail_cache_max_bytes": 2 * 1024 * 1024 * 1024,
                },
            )

    async def test_clear_thumbnail_cache_does_not_touch_the_database(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            settings = ShelfSettings(root, root / "settings.json")
            repository = ImageRepository(root / "image-shelf.sqlite3")
            cache = root / "cache"
            cache_file = cache / "v1" / "aa" / ("a" * 64 + ".webp")
            cache_file.parent.mkdir(parents=True)
            cache_file.write_bytes(b"thumbnail")
            api = GalleryApi(repository, settings, cache)

            response = await api.clear_thumbnail_cache(Mock())

            self.assertEqual(response.status, 200)
            self.assertFalse(cache_file.exists())
            self.assertTrue(repository.database_path.exists())
            repository.close()


if __name__ == "__main__":
    unittest.main()
