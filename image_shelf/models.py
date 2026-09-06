from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class IndexedImage:
    path: Path
    width: int
    height: int
    file_size: int
    created_at: float
    mtime: float
    workflow: str | None
    parse_error: str | None
    tags: tuple[str, ...]
    negative_tags: tuple[str, ...]


@dataclass(frozen=True)
class ParsedWorkflow:
    workflow: str | None
    tags: tuple[str, ...]
    negative_tags: tuple[str, ...]
    parse_error: str | None


@dataclass(frozen=True)
class GalleryImage:
    id: str
    filename: str
    extension: str
    width: int
    height: int
    file_size: int
    created_at: float
    parse_error: str | None


@dataclass(frozen=True)
class ImagePage:
    items: tuple[GalleryImage, ...]
    page: int
    page_size: int
    total: int
    dimensions: tuple[DimensionFacet, ...]


@dataclass(frozen=True)
class ImageDetails:
    id: str
    filename: str
    extension: str
    width: int
    height: int
    file_size: int
    created_at: float
    parse_error: str | None
    tags: tuple[str, ...]
    negative_tags: tuple[str, ...]


@dataclass(frozen=True)
class DimensionFacet:
    width: int
    height: int
    count: int


@dataclass(frozen=True)
class TagSuggestion:
    name: str
    type: str


@dataclass(frozen=True)
class GalleryTab:
    id: str
    name: str
    folders: tuple[Path, ...]
    editable: bool = False
    removable: bool = False

    def dict(self) -> dict[str, Any]:
        return {
            **self.__dict__,
            "folders": [str(folder) for folder in self.folders],
        }
