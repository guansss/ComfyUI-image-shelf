from __future__ import annotations

import sqlite3
from collections.abc import Iterable
from difflib import SequenceMatcher
from os import sep
from pathlib import Path
from threading import RLock
from uuid import uuid4

from .models import (
    DimensionFacet,
    GalleryImage,
    ImageDetails,
    ImagePage,
    IndexedImage,
    TagSuggestion,
)
from .paths import normalize_path
from .search import SearchTerm


class ImageRepository:
    def __init__(self, database_path: str | Path) -> None:
        self.connection = sqlite3.connect(database_path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self._lock = RLock()
        self.connection.execute("PRAGMA foreign_keys = ON")
        self._migrate()

    def close(self) -> None:
        with self._lock:
            self.connection.close()

    def upsert_image(self, image: IndexedImage) -> int:
        normalized_path = str(normalize_path(image.path))
        with self._lock, self.connection:
            self.connection.execute(
                """
                INSERT INTO images (
                    public_id, path, filename, extension, width, height, file_size,
                    created_at, mtime, workflow, parse_error
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(path) DO UPDATE SET
                    filename = excluded.filename,
                    extension = excluded.extension,
                    width = excluded.width,
                    height = excluded.height,
                    file_size = excluded.file_size,
                    created_at = excluded.created_at,
                    mtime = excluded.mtime,
                    workflow = excluded.workflow,
                    parse_error = excluded.parse_error
                """,
                (
                    uuid4().hex,
                    normalized_path,
                    image.path.name,
                    image.path.suffix.lower(),
                    image.width,
                    image.height,
                    image.file_size,
                    image.created_at,
                    image.mtime,
                    image.workflow,
                    image.parse_error,
                ),
            )
            row = self.connection.execute(
                "SELECT id FROM images WHERE path = ?", (normalized_path,)
            ).fetchone()
            if row is None:
                raise RuntimeError("Image upsert did not return an image ID")
            image_id = int(row["id"])
            self._replace_tags(image_id, image.tags, "positive")
            self._replace_tags(image_id, image.negative_tags, "negative")
            self._update_search_index(image_id)
        return image_id

    def list_images(
        self,
        folders: Iterable[str | Path],
        terms: Iterable[SearchTerm] = (),
        dimensions: Iterable[tuple[int, int]] = (),
        sort_by: str = "created_at",
        direction: str = "desc",
        page: int = 1,
        page_size: int = 100,
    ) -> ImagePage:
        if page < 1 or not 1 <= page_size <= 200:
            raise ValueError(
                "page must be positive and page_size must be between 1 and 200"
            )
        if sort_by not in {"created_at", "filename"} or direction not in {
            "asc",
            "desc",
        }:
            raise ValueError("Unsupported sort order")

        terms = tuple(terms)
        where, parameters = self._build_image_filter(folders, terms, dimensions)
        order_column = {
            "created_at": "images.created_at",
            "filename": "images.filename",
        }[sort_by]
        order_direction = direction.upper()
        where_sql = " AND ".join(where)
        where_without_dimensions, parameters_without_dimensions = (
            self._build_image_filter(folders, terms)
        )
        with self._lock:
            total = int(
                self.connection.execute(
                    f"SELECT COUNT(*) FROM images WHERE {where_sql}", parameters
                ).fetchone()[0]
            )
            rows = self.connection.execute(
                f"""
                SELECT public_id, filename, extension, width, height, file_size,
                       created_at, parse_error
                FROM images
                WHERE {where_sql}
                ORDER BY {order_column} {order_direction}, images.id DESC
                LIMIT ? OFFSET ?
                """,
                (*parameters, page_size, (page - 1) * page_size),
            ).fetchall()
            dimension_facets = self.connection.execute(
                f"""
                SELECT width, height, COUNT(*) AS count
                FROM images
                WHERE {" AND ".join(where_without_dimensions)}
                GROUP BY width, height
                ORDER BY count DESC, width DESC, height DESC
                """,
                parameters_without_dimensions,
            ).fetchall()
        return ImagePage(
            items=tuple(
                GalleryImage(
                    id=row["public_id"],
                    filename=row["filename"],
                    extension=row["extension"],
                    width=row["width"],
                    height=row["height"],
                    file_size=row["file_size"],
                    created_at=row["created_at"],
                    parse_error=row["parse_error"],
                )
                for row in rows
            ),
            page=page,
            page_size=page_size,
            total=total,
            dimensions=tuple(
                DimensionFacet(row["width"], row["height"], row["count"])
                for row in dimension_facets
            ),
        )

    def suggest_tags(
        self, folders: Iterable[str | Path] | None, prefix: str, limit: int = 10
    ) -> tuple[TagSuggestion, ...]:
        if not prefix.strip() or not 1 <= limit <= 50:
            return ()
        folder_where, folder_parameters = (
            ("1", ()) if folders is None else self._folder_filter(folders)
        )
        if folder_where == "0":
            return ()
        with self._lock:
            rows = self.connection.execute(
                f"""
                SELECT tags.name, tags.normalized_name, tags.type, COUNT(*) AS count
                FROM tags
                INNER JOIN image_tags ON image_tags.tag_id = tags.id
                INNER JOIN images ON images.id = image_tags.image_id
                WHERE ({folder_where})
                GROUP BY tags.id
                ORDER BY count DESC, tags.name ASC
                LIMIT 1000
                """,
                folder_parameters,
            ).fetchall()
        normalized_prefix = prefix.strip().lower()
        ranked_rows = sorted(
            (
                (_tag_match_score(normalized_prefix, row["normalized_name"]), row)
                for row in rows
            ),
            key=lambda item: (-item[0], -item[1]["count"], item[1]["name"]),
        )
        return tuple(
            TagSuggestion(row["name"], row["type"])
            for score, row in ranked_rows
            if score > 0
        )[:limit]

    def path_for_public_id(self, public_id: str) -> Path | None:
        with self._lock:
            row = self.connection.execute(
                "SELECT path FROM images WHERE public_id = ?", (public_id,)
            ).fetchone()
        return Path(row["path"]) if row is not None else None

    def image_details(self, public_id: str) -> ImageDetails | None:
        with self._lock:
            row = self.connection.execute(
                """
                SELECT public_id, filename, extension, width, height, file_size,
                       created_at, parse_error
                FROM images WHERE public_id = ?
                """,
                (public_id,),
            ).fetchone()
            if row is None:
                return None
            tags = self.connection.execute(
                """
                SELECT name, type FROM tags
                INNER JOIN image_tags ON image_tags.tag_id = tags.id
                INNER JOIN images ON images.id = image_tags.image_id
                WHERE images.public_id = ?
                ORDER BY tags.name ASC
                """,
                (public_id,),
            ).fetchall()
        return ImageDetails(
            id=row["public_id"],
            filename=row["filename"],
            extension=row["extension"],
            width=row["width"],
            height=row["height"],
            file_size=row["file_size"],
            created_at=row["created_at"],
            parse_error=row["parse_error"],
            tags=tuple(tag["name"] for tag in tags if tag["type"] == "positive"),
            negative_tags=tuple(
                tag["name"] for tag in tags if tag["type"] == "negative"
            ),
        )

    def delete_path(self, path: str | Path) -> None:
        with self._lock, self.connection:
            self.connection.execute(
                "DELETE FROM images WHERE path = ?", (str(normalize_path(path)),)
            )

    def delete_untracked_paths(self, tracked_folders: Iterable[str | Path]) -> None:
        folders = tuple(str(normalize_path(folder)) for folder in tracked_folders)
        if not folders:
            with self._lock, self.connection:
                self.connection.execute("DELETE FROM images")
            return

        conditions = " OR ".join("path = ? OR path LIKE ? ESCAPE '\\'" for _ in folders)
        parameters = tuple(
            parameter
            for folder in folders
            for parameter in (folder, _directory_like_pattern(folder))
        )
        with self._lock, self.connection:
            self.connection.execute(
                f"DELETE FROM images WHERE NOT ({conditions})", parameters
            )

    def image_is_current(self, path: str | Path, mtime: float, file_size: int) -> bool:
        with self._lock:
            row = self.connection.execute(
                "SELECT mtime, file_size FROM images WHERE path = ?",
                (str(normalize_path(path)),),
            ).fetchone()
        return (
            row is not None and row["mtime"] == mtime and row["file_size"] == file_size
        )

    def paths_in_folder(self, folder: str | Path) -> set[Path]:
        normalized_folder = str(normalize_path(folder))
        with self._lock:
            rows = self.connection.execute(
                "SELECT path FROM images WHERE path = ? OR path LIKE ? ESCAPE '\\'",
                (normalized_folder, _directory_like_pattern(normalized_folder)),
            ).fetchall()
        normalized_folder_path = Path(normalized_folder)
        return {
            path
            for row in rows
            if (path := Path(row["path"])).parent == normalized_folder_path
        }

    def _replace_tags(self, image_id: int, tags: Iterable[str], tag_type: str) -> None:
        self.connection.execute(
            """
            DELETE FROM image_tags
            WHERE image_id = ? AND tag_id IN (SELECT id FROM tags WHERE type = ?)
            """,
            (image_id, tag_type),
        )
        for tag in tags:
            normalized_name = tag.lower()
            self.connection.execute(
                """
                INSERT INTO tags (name, normalized_name, type) VALUES (?, ?, ?)
                ON CONFLICT(normalized_name, type) DO NOTHING
                """,
                (tag, normalized_name, tag_type),
            )
            tag_row = self.connection.execute(
                "SELECT id FROM tags WHERE normalized_name = ? AND type = ?",
                (normalized_name, tag_type),
            ).fetchone()
            if tag_row is not None:
                self.connection.execute(
                    "INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)",
                    (image_id, tag_row["id"]),
                )

    def _update_search_index(self, image_id: int) -> None:
        image = self.connection.execute(
            "SELECT filename, workflow FROM images WHERE id = ?", (image_id,)
        ).fetchone()
        tags = self.connection.execute(
            """
            SELECT tags.name FROM tags
            INNER JOIN image_tags ON image_tags.tag_id = tags.id
            WHERE image_tags.image_id = ?
            """,
            (image_id,),
        ).fetchall()
        tag_text = " ".join(tag["name"] for tag in tags)
        self.connection.execute("DELETE FROM image_search WHERE rowid = ?", (image_id,))
        self.connection.execute(
            "INSERT INTO image_search (rowid, filename, tags, workflow) VALUES (?, ?, ?, ?)",
            (image_id, image["filename"], tag_text, image["workflow"] or ""),
        )

    def _migrate(self) -> None:
        try:
            self.connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS images (
                    id INTEGER PRIMARY KEY,
                    public_id TEXT NOT NULL UNIQUE,
                    path TEXT NOT NULL UNIQUE,
                    filename TEXT NOT NULL,
                    extension TEXT NOT NULL,
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL,
                    file_size INTEGER NOT NULL,
                    created_at REAL NOT NULL,
                    mtime REAL NOT NULL,
                    workflow TEXT,
                    parse_error TEXT
                );
                CREATE INDEX IF NOT EXISTS images_created_at_idx ON images(created_at DESC);
                CREATE INDEX IF NOT EXISTS images_dimensions_idx ON images(width, height);

                CREATE TABLE IF NOT EXISTS tags (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    normalized_name TEXT NOT NULL,
                    type TEXT NOT NULL CHECK(type IN ('positive', 'negative')),
                    UNIQUE(normalized_name, type)
                );
                CREATE TABLE IF NOT EXISTS image_tags (
                    image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
                    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                    PRIMARY KEY(image_id, tag_id)
                );
                CREATE INDEX IF NOT EXISTS image_tags_tag_id_idx ON image_tags(tag_id);

                CREATE TABLE IF NOT EXISTS tabs (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    folder_path TEXT NOT NULL
                );

                CREATE VIRTUAL TABLE IF NOT EXISTS image_search USING fts5(
                    filename, tags, workflow
                );
                """
            )
            columns = {
                row["name"]
                for row in self.connection.execute(
                    "PRAGMA table_info(images)"
                ).fetchall()
            }
            if "public_id" not in columns:
                self.connection.execute("ALTER TABLE images ADD COLUMN public_id TEXT")
                self.connection.execute(
                    "UPDATE images SET public_id = lower(hex(randomblob(16))) WHERE public_id IS NULL"
                )
                self.connection.execute(
                    "CREATE UNIQUE INDEX IF NOT EXISTS images_public_id_idx ON images(public_id)"
                )
        except sqlite3.OperationalError as error:
            if "fts5" in str(error).lower():
                raise RuntimeError(
                    "ComfyUI Image Shelf requires SQLite with FTS5 support."
                ) from error
            raise

    def _build_image_filter(
        self,
        folders: Iterable[str | Path],
        terms: Iterable[SearchTerm],
        dimensions: Iterable[tuple[int, int]] = (),
    ) -> tuple[list[str], list[object]]:
        folder_where, folder_parameters = self._folder_filter(folders)
        where = [f"({folder_where})"]
        parameters: list[object] = list(folder_parameters)

        dimension_values = tuple(dimensions)
        if dimension_values:
            where.append(
                "("
                + " OR ".join(
                    "(images.width = ? AND images.height = ?)" for _ in dimension_values
                )
                + ")"
            )
            parameters.extend(
                value for dimension in dimension_values for value in dimension
            )

        for term in terms:
            condition, condition_parameters = _term_filter(term)
            where.append(f"NOT ({condition})" if term.excluded else f"({condition})")
            parameters.extend(condition_parameters)
        return where, parameters

    def _folder_filter(
        self, folders: Iterable[str | Path]
    ) -> tuple[str, tuple[object, ...]]:
        normalized_folders = tuple(str(normalize_path(folder)) for folder in folders)
        if not normalized_folders:
            return "0", ()
        clauses = " OR ".join(
            "images.path = ? OR images.path LIKE ? ESCAPE '\\'"
            for _ in normalized_folders
        )
        parameters = tuple(
            parameter
            for folder in normalized_folders
            for parameter in (folder, _directory_like_pattern(folder))
        )
        return clauses, parameters


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _directory_like_pattern(folder: str) -> str:
    return f"{_escape_like(folder)}{_escape_like(sep)}%"


def _tag_match_score(query: str, tag: str) -> float:
    if tag.startswith(query):
        return 1.0
    if query in tag:
        return 0.8
    ratio = SequenceMatcher(None, query, tag).ratio()
    return ratio if ratio >= 0.55 else 0.0


def _term_filter(term: SearchTerm) -> tuple[str, tuple[object, ...]]:
    if term.field == "tag":
        return (
            """
            EXISTS (
                SELECT 1 FROM image_tags
                INNER JOIN tags ON tags.id = image_tags.tag_id
                WHERE image_tags.image_id = images.id
                  AND tags.normalized_name = ?
                  AND tags.type = ?
            )
            """,
            (term.value, term.tag_type),
        )
    if term.field == "name":
        return "images.filename LIKE ? ESCAPE '\\'", (f"%{_escape_like(term.value)}%",)
    return (
        "images.id IN (SELECT rowid FROM image_search WHERE image_search MATCH ?)",
        (_fts_phrase(term.value),),
    )


def _fts_phrase(value: str) -> str:
    return f'"{value.replace(chr(34), chr(34) * 2)}"'
