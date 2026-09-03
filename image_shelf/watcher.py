from __future__ import annotations

import asyncio
from pathlib import Path
from threading import Lock, Timer

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from .indexer import FolderIndexer, SUPPORTED_EXTENSIONS
from .paths import normalize_path


class FolderWatcher:
    """Debounce filesystem events into full, background-safe folder reconciliations."""

    def __init__(self, indexer: FolderIndexer, loop: asyncio.AbstractEventLoop) -> None:
        self.indexer = indexer
        self.loop = loop
        self.observer = Observer()
        self._watches: dict[Path, object] = {}
        self._timers: dict[Path, Timer] = {}
        self._lock = Lock()

    def start(self, folders: tuple[Path, ...]) -> None:
        self.reconfigure(folders)
        if not self.observer.is_alive():
            self.observer.start()

    def reconfigure(self, folders: tuple[Path, ...]) -> None:
        requested_folders = set(normalize_path(folder) for folder in folders)
        for folder in set(self._watches) - requested_folders:
            watch = self._watches.pop(folder)
            self.observer.unschedule(watch)
            self._cancel_timer(folder)
        for folder in requested_folders - set(self._watches):
            if folder.is_dir():
                self._watches[folder] = self.observer.schedule(
                    _IndexEventHandler(folder, self._queue_index), str(folder), recursive=False
                )

    def stop(self) -> None:
        for folder in tuple(self._timers):
            self._cancel_timer(folder)
        if self.observer.is_alive():
            self.observer.stop()
            self.observer.join(timeout=5)

    def _queue_index(self, folder: Path) -> None:
        with self._lock:
            self._cancel_timer(folder)
            timer = Timer(0.3, self._submit_index, args=(folder,))
            timer.daemon = True
            self._timers[folder] = timer
            timer.start()

    def _submit_index(self, folder: Path) -> None:
        with self._lock:
            self._timers.pop(folder, None)
        self.loop.call_soon_threadsafe(asyncio.create_task, self.indexer.index_folder(folder))

    def _cancel_timer(self, folder: Path) -> None:
        timer = self._timers.pop(folder, None)
        if timer:
            timer.cancel()


class _IndexEventHandler(FileSystemEventHandler):
    def __init__(self, folder: Path, callback: object) -> None:
        self.folder = folder
        self.callback = callback

    def on_any_event(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        paths = (Path(event.src_path), Path(getattr(event, "dest_path", event.src_path)))
        if any(path.suffix.lower() in SUPPORTED_EXTENSIONS for path in paths):
            self.callback(self.folder)
