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

_PAGE_SIZE_LIMIT = 1000
_IMAGE_COLUMNS = 11
_WORKFLOW_COLUMNS = 1


class ImageRepository:
    def __init__(self, database_path: str | Path) -> None:
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.database_path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self._lock = RLock()
        self._image_insert_batch_size = max(
            1,
            self._parameter_limit() // _IMAGE_COLUMNS,
        )
        self._workflow_insert_batch_size = max(
            1,
            self._parameter_limit() // _WORKFLOW_COLUMNS,
        )
        self.connection.execute("PRAGMA foreign_keys = ON")
        self._migrate()

    def _parameter_limit(self) -> int:
        try:
            return self.connection.getlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER)
        except AttributeError:
            for (option,) in self.connection.execute("PRAGMA compile_options"):
                if option.startswith("MAX_VARIABLE_NUMBER="):
                    return int(option.partition("=")[2])
            # Fallback to a known limit of legacy SQLite versions (3.32.0 and earlier)
            return 999

    def close(self) -> None:
        with self._lock:
            self.connection.close()

    def upsert_image(self, image: IndexedImage) -> int:
        return self.upsert_images((image,))[0]

    def upsert_images(self, images: Iterable[IndexedImage]) -> tuple[int, ...]:
        images = tuple(images)
        if not images:
            return ()
        with self._lock, self.connection:
            unique_images = {normalize_path(image.path): image for image in images}
            workflow_ids = self._upsert_workflows(unique_images.values())
            image_ids_by_path: dict[Path, int] = {}
            unique_image_items = tuple(unique_images.items())
            for start in range(
                0, len(unique_image_items), self._image_insert_batch_size
            ):
                image_rows = unique_image_items[
                    start : start + self._image_insert_batch_size
                ]
                image_ids_by_path.update(
                    self._upsert_image_rows(image_rows, workflow_ids)
                )

            self._replace_tags_batch(
                (
                    (image_ids_by_path[path], image.tags)
                    for path, image in unique_images.items()
                ),
                "positive",
            )
            self._replace_tags_batch(
                (
                    (image_ids_by_path[path], image.negative_tags)
                    for path, image in unique_images.items()
                ),
                "negative",
            )
        return tuple(image_ids_by_path[normalize_path(image.path)] for image in images)

    def _upsert_image_rows(
        self,
        image_rows: tuple[tuple[Path, IndexedImage], ...],
        workflow_ids: dict[str, int] | None = None,
    ) -> dict[Path, int]:
        workflow_ids = workflow_ids or {}
        values: list[object] = []
        for normalized_path, image in image_rows:
            values.extend(
                (
                    uuid4().hex,
                    str(normalized_path),
                    image.path.name,
                    image.path.suffix.lower(),
                    image.width,
                    image.height,
                    image.file_size,
                    image.created_at,
                    image.mtime,
                    workflow_ids.get(image.workflow) if image.workflow else None,
                    image.parse_error,
                )
            )
        actual_columns, remainder = divmod(len(values), len(image_rows))
        if remainder or actual_columns > _IMAGE_COLUMNS:
            raise RuntimeError(
                f"Image insert has {actual_columns} bound columns per image; "
                f"the maximum supported is {_IMAGE_COLUMNS}"
            )
        row_placeholders = "(" + ", ".join("?" for _ in range(_IMAGE_COLUMNS)) + ")"
        query = f"""
            INSERT INTO images (
                public_id, path, filename, extension, width, height, file_size,
                created_at, mtime, workflow_id, parse_error
            ) VALUES {", ".join(row_placeholders for _ in image_rows)}
            ON CONFLICT(path) DO UPDATE SET
                filename = excluded.filename,
                extension = excluded.extension,
                width = excluded.width,
                height = excluded.height,
                file_size = excluded.file_size,
                created_at = excluded.created_at,
                mtime = excluded.mtime,
                workflow_id = excluded.workflow_id,
                parse_error = excluded.parse_error
            RETURNING id, path
        """
        rows = self.connection.execute(query, values).fetchall()
        result = {Path(row["path"]): int(row["id"]) for row in rows}
        if len(result) != len(image_rows):
            raise RuntimeError("Image upsert did not return every image ID")
        return result

    def _upsert_workflows(self, images: Iterable[IndexedImage]) -> dict[str, int]:
        workflows = {image.workflow for image in images if image.workflow}
        workflow_ids: dict[str, int] = {}
        workflows = tuple(workflows)
        for start in range(0, len(workflows), self._workflow_insert_batch_size):
            workflow_rows = workflows[start : start + self._workflow_insert_batch_size]
            values: list[object] = list(workflow_rows)
            actual_columns, remainder = divmod(len(values), len(workflow_rows))
            if remainder or actual_columns > _WORKFLOW_COLUMNS:
                raise RuntimeError(
                    f"Workflow insert has {actual_columns} bound columns per workflow; "
                    f"the maximum supported is {_WORKFLOW_COLUMNS}"
                )
            row_placeholders = (
                "(" + ", ".join("?" for _ in range(_WORKFLOW_COLUMNS)) + ")"
            )
            rows = self.connection.execute(
                f"""
                INSERT INTO workflows (content)
                VALUES {", ".join(row_placeholders for _ in workflow_rows)}
                ON CONFLICT(content) DO UPDATE SET content = excluded.content
                RETURNING id, content
                """,
                values,
            ).fetchall()
            workflow_ids.update({row["content"]: int(row["id"]) for row in rows})
        if len(workflow_ids) != len(workflows):
            raise RuntimeError("Workflow upsert did not return every workflow ID")
        return workflow_ids

    def list_images(
        self,
        folders: Iterable[str | Path],
        terms: Iterable[SearchTerm] = (),
        dimensions: Iterable[tuple[int, int]] = (),
        sort_by: str = "created_at",
        direction: str = "desc",
        page: int = 1,
        page_size: int = 10,
    ) -> ImagePage:
        if page < 1 or not 1 <= page_size <= _PAGE_SIZE_LIMIT:
            raise ValueError(
                f"page must be positive and page_size must be between 1 and {_PAGE_SIZE_LIMIT}"
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
        if (not prefix.strip() and prefix != "") or limit <= 0:
            return ()
        limit = min(limit, 1000)
        folder_where, folder_parameters = (
            ("1", ()) if folders is None else self._folder_filter(folders)
        )
        if folder_where == "0":
            return ()
        normalized_prefix = prefix.strip().lower()
        like_pattern = f"%{_escape_like(normalized_prefix)}%"
        with self._lock:
            rows = self.connection.execute(
                f"""
                SELECT tags.name, tags.normalized_name, tags.type, COUNT(*) AS count
                FROM tags
                INNER JOIN image_tags ON image_tags.tag_id = tags.id
                INNER JOIN images ON images.id = image_tags.image_id
                WHERE ({folder_where}) AND tags.normalized_name LIKE ? ESCAPE '\\'
                GROUP BY tags.id
                ORDER BY count DESC, tags.name ASC
                LIMIT 1000
                """,
                (*folder_parameters, like_pattern),
            ).fetchall()
        ranked_rows = sorted(
            (
                (_tag_match_score(normalized_prefix, row["normalized_name"]), row)
                for row in rows
            ),
            key=lambda item: (-item[0], -item[1]["count"], item[1]["name"]),
        )
        return tuple(TagSuggestion(row["name"], row["type"], row["count"]) for _, row in ranked_rows)[
            :limit
        ]

    def path_for_public_id(self, public_id: str) -> Path | None:
        with self._lock:
            row = self.connection.execute(
                "SELECT path FROM images WHERE public_id = ?", (public_id,)
            ).fetchone()
        return Path(row["path"]) if row is not None else None

    def image_details(self, public_id: str) -> tuple[ImageDetails, str] | None:
        with self._lock:
            row = self.connection.execute(
                """
                SELECT public_id, path, filename, extension, width, height, file_size,
                       created_at, parse_error
                FROM images WHERE public_id = ?
                """,
                (public_id,),
            ).fetchone()
            if row is None:
                return None
            tags = self.connection.execute(
                """
                SELECT current_tag.name, current_tag.type,
                       COUNT(DISTINCT associated_image_tags.image_id) AS count
                FROM tags AS current_tag
                INNER JOIN image_tags AS current_image_tags
                    ON current_image_tags.tag_id = current_tag.id
                INNER JOIN images AS current_image
                    ON current_image.id = current_image_tags.image_id
                INNER JOIN image_tags AS associated_image_tags
                    ON associated_image_tags.tag_id = current_tag.id
                WHERE current_image.public_id = ?
                GROUP BY current_tag.id
                """,
                (public_id,),
            ).fetchall()
        return (
            ImageDetails(
                id=row["public_id"],
                filename=row["filename"],
                extension=row["extension"],
                width=row["width"],
                height=row["height"],
                file_size=row["file_size"],
                created_at=row["created_at"],
                parse_error=row["parse_error"],
                tags=tuple(
                    TagSuggestion(tag["name"], tag["type"], tag["count"])
                    for tag in tags
                ),
            ),
            row["path"],
        )

    def delete_path(self, path: str | Path) -> None:
        with self._lock, self.connection:
            self.connection.execute(
                "DELETE FROM images WHERE path = ?", (str(normalize_path(path)),)
            )
            self._prune_workflows()

    def delete_untracked_paths(self, tracked_folders: Iterable[str | Path]) -> None:
        folders = tuple(str(normalize_path(folder)) for folder in tracked_folders)
        if not folders:
            with self._lock, self.connection:
                self.connection.execute("DELETE FROM images")
                self.connection.execute("DELETE FROM workflows")
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
            self._prune_workflows()

    def _prune_workflows(self) -> None:
        self.connection.execute(
            "DELETE FROM workflows WHERE id NOT IN "
            "(SELECT workflow_id FROM images WHERE workflow_id IS NOT NULL)"
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
        return set(self.image_states_in_folder(folder))

    def image_states_in_folder(
        self, folder: str | Path
    ) -> dict[Path, tuple[float, int]]:
        normalized_folder = str(normalize_path(folder))
        with self._lock:
            rows = self.connection.execute(
                """
                SELECT path, mtime, file_size
                FROM images
                WHERE path = ? OR path LIKE ? ESCAPE '\\'
                """,
                (normalized_folder, _directory_like_pattern(normalized_folder)),
            ).fetchall()
        normalized_folder_path = Path(normalized_folder)
        return {
            path: (row["mtime"], row["file_size"])
            for row in rows
            if (path := Path(row["path"])).parent == normalized_folder_path
        }

    def _replace_tags_batch(
        self,
        image_tags: Iterable[tuple[int, Iterable[str]]],
        tag_type: str,
    ) -> None:
        image_tag_rows: list[tuple[int, str, str]] = []
        image_ids: list[int] = []
        seen_image_ids: set[int] = set()
        tag_definitions: dict[tuple[str, str], str] = {}
        for image_id, tags in image_tags:
            if image_id not in seen_image_ids:
                image_ids.append(image_id)
                seen_image_ids.add(image_id)
            seen_tags: set[str] = set()
            for tag in tags:
                normalized_name = tag.lower()
                if normalized_name in seen_tags:
                    continue
                seen_tags.add(normalized_name)
                tag_key = (normalized_name, tag_type)
                tag_definitions.setdefault(tag_key, tag)
                image_tag_rows.append((image_id, normalized_name, tag_type))

        parameter_limit = self._parameter_limit()
        image_delete_batch_size = max(1, parameter_limit - 1)
        for start in range(0, len(image_ids), image_delete_batch_size):
            image_id_batch = image_ids[
                start : start + image_delete_batch_size
            ]
            placeholders = ", ".join("?" for _ in image_id_batch)
            self.connection.execute(
                f"""
                DELETE FROM image_tags
                WHERE image_id IN ({placeholders})
                  AND tag_id IN (SELECT id FROM tags WHERE type = ?)
                """,
                (*image_id_batch, tag_type),
            )

        definition_items = tuple(tag_definitions.items())
        definition_batch_size = max(1, parameter_limit // 3)
        for start in range(0, len(definition_items), definition_batch_size):
            definition_batch = definition_items[start : start + definition_batch_size]
            self.connection.execute(
                f"""
                INSERT INTO tags (name, normalized_name, type)
                VALUES {", ".join("(?, ?, ?)" for _ in definition_batch)}
                ON CONFLICT(normalized_name, type) DO NOTHING
                """,
                tuple(
                    value
                    for (normalized_name, tag_type), name in definition_batch
                    for value in (name, normalized_name, tag_type)
                ),
            )

        tag_ids: dict[tuple[str, str], int] = {}
        tag_keys = tuple(tag_definitions)
        tag_lookup_batch_size = max(1, parameter_limit // 2)
        for start in range(0, len(tag_keys), tag_lookup_batch_size):
            tag_key_batch = tag_keys[start : start + tag_lookup_batch_size]
            conditions = " OR ".join(
                "(normalized_name = ? AND type = ?)" for _ in tag_key_batch
            )
            rows = self.connection.execute(
                f"SELECT id, normalized_name, type FROM tags WHERE {conditions}",
                tuple(value for tag_key in tag_key_batch for value in tag_key),
            ).fetchall()
            tag_ids.update(
                {
                    (row["normalized_name"], row["type"]): int(row["id"])
                    for row in rows
                }
            )

        link_rows = [
            (image_id, tag_ids[(normalized_name, tag_type)])
            for image_id, normalized_name, tag_type in image_tag_rows
        ]
        link_batch_size = max(1, parameter_limit // 2)
        for start in range(0, len(link_rows), link_batch_size):
            link_batch = link_rows[start : start + link_batch_size]
            self.connection.execute(
                f"""
                INSERT OR IGNORE INTO image_tags (image_id, tag_id)
                VALUES {", ".join("(?, ?)" for _ in link_batch)}
                """,
                tuple(value for row in link_batch for value in row),
            )

    def _migrate(self) -> None:
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
                workflow_id INTEGER REFERENCES workflows(id),
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

            CREATE TABLE IF NOT EXISTS workflows (
                id INTEGER PRIMARY KEY,
                content TEXT NOT NULL UNIQUE
            );

            """
        )
        columns = {
            row["name"]
            for row in self.connection.execute("PRAGMA table_info(images)").fetchall()
        }
        if "public_id" not in columns:
            self.connection.execute("ALTER TABLE images ADD COLUMN public_id TEXT")
            self.connection.execute(
                "UPDATE images SET public_id = lower(hex(randomblob(16))) WHERE public_id IS NULL"
            )
            self.connection.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS images_public_id_idx ON images(public_id)"
            )
        if "workflow_id" not in columns:
            self.connection.execute(
                "ALTER TABLE images ADD COLUMN workflow_id INTEGER REFERENCES workflows(id)"
            )
            self.connection.execute(
                """
                INSERT INTO workflows (content)
                SELECT DISTINCT workflow FROM images
                WHERE workflow IS NOT NULL AND workflow <> ''
                ON CONFLICT(content) DO NOTHING
                """
            )
            self.connection.execute(
                """
                UPDATE images
                SET workflow_id = (
                    SELECT id FROM workflows WHERE content = images.workflow
                )
                WHERE workflow IS NOT NULL AND workflow <> ''
                """
            )
            self.connection.execute("UPDATE images SET workflow = NULL")

        self._prune_workflows()
        self.connection.commit()

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
            "images.path = ? OR ("
            "images.path LIKE ? ESCAPE '\\' AND "
            "images.path NOT LIKE ? ESCAPE '\\')"
            for _ in normalized_folders
        )
        parameters = tuple(
            parameter
            for folder in normalized_folders
            for parameter in (
                folder,
                _directory_like_pattern(folder),
                _nested_directory_like_pattern(folder),
            )
        )
        return clauses, parameters


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _directory_like_pattern(folder: str) -> str:
    return f"{_escape_like(folder)}{_escape_like(sep)}%"


def _nested_directory_like_pattern(folder: str) -> str:
    return f"{_escape_like(folder)}{_escape_like(sep)}%{_escape_like(sep)}%"


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
    if term.field == "info":
        return (
            (
                "images.workflow_id IN ("
                "SELECT id FROM workflows WHERE content LIKE ? ESCAPE '\\'"
                ")"
            ),
            (f"%{_escape_like(term.value)}%",),
        )
