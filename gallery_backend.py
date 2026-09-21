from __future__ import annotations

import argparse
import logging
from pathlib import Path

from aiohttp import web

from image_shelf.api import create_gallery_app
from image_shelf.configuration import (
    ShelfSettings,
    load_standalone_configuration,
    set_settings,
)
from image_shelf.log import debug_logger


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Image Shelf development API.")
    parser.add_argument("--database", type=Path, default=Path("image-shelf.sqlite3"))
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--host", default="127.0.0.1")
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    debug_logger.disabled = False
    args = parse_args()
    try:
        configuration = load_standalone_configuration(args.env_file)
    except ValueError as error:
        raise SystemExit(str(error)) from error

    settings = ShelfSettings(
        output_folder=configuration.output_folder,
        settings_path=configuration.settings_path,
    )
    set_settings(settings)
    app = create_gallery_app(
        args.database.resolve(),
        settings=settings,
        allow_development_cors=True,
    )
    web.run_app(app, host=args.host, port=configuration.port, access_log=None)


if __name__ == "__main__":
    main()
