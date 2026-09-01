from __future__ import annotations

from pathlib import Path


def normalize_path(path: str | Path) -> Path:
    """Return a resolved absolute path with platform-specific case normalization."""
    return Path(path).expanduser().resolve(strict=False)


def is_within_directory(path: str | Path, directory: str | Path) -> bool:
    """Return whether a path is contained by a configured directory."""
    normalized_path = normalize_path(path)
    normalized_directory = normalize_path(directory)
    try:
        normalized_path.relative_to(normalized_directory)
    except ValueError:
        return False
    return True
