from __future__ import annotations

import argparse
from pathlib import Path

from aiohttp import web

from image_shelf.api import create_gallery_app
from image_shelf.configuration import load_standalone_configuration, load_standalone_tabs


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Image Shelf development API.")
    parser.add_argument("--database", type=Path, default=Path("image-shelf.sqlite3"))
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8189)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        configuration = load_standalone_configuration(args.env_file)
    except ValueError as error:
        raise SystemExit(str(error)) from error
    app = create_gallery_app(
        args.database,
        tabs=load_standalone_tabs(configuration),
        allow_development_cors=True,
        tab_reloader=lambda: load_standalone_tabs(configuration),
    )
    web.run_app(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()