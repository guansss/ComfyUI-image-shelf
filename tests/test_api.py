import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock

from image_shelf.api import GalleryApi
from image_shelf.indexer import IndexingResult
from image_shelf.models import GalleryTab


class GalleryApiIndexingEventsTests(unittest.IsolatedAsyncioTestCase):
    async def test_broadcasts_index_events_for_each_tab_sharing_a_folder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            folder = Path(temporary_directory)
            api = GalleryApi(None, None)
            api.tabs = (
                GalleryTab("tab-1", "First", (folder,)),
                GalleryTab("tab-2", "Second", (folder,)),
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
                    {"event": "indexStart", "data": {"tab": "tab-1"}},
                    {"event": "indexStart", "data": {"tab": "tab-2"}},
                    {
                        "event": "indexFinish",
                        "data": {
                            "tab": "tab-1",
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
                            "tab": "tab-2",
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
            api = GalleryApi(None, None)
            api.tabs = (GalleryTab("tab-1", "First", (folder,)),)
            websocket = Mock()
            websocket.send_json = AsyncMock()
            api.websocket_clients.add(websocket)
            api.indexer.index_folder = AsyncMock(side_effect=RuntimeError("failed"))

            with self.assertRaisesRegex(RuntimeError, "failed"):
                await api._index_folder_and_broadcast(folder)

            self.assertEqual(
                [call.args[0] for call in websocket.send_json.await_args_list],
                [
                    {"event": "indexStart", "data": {"tab": "tab-1"}},
                    {
                        "event": "indexFinish",
                        "data": {"tab": "tab-1", "error": "failed"},
                    },
                ],
            )


if __name__ == "__main__":
    unittest.main()
