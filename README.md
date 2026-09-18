# ComfyUI Image Shelf

ComfyUI Image Shelf adds an in-app gallery for browsing generated images by folder, filename, prompt tags, dimensions, and creation date.

## Development Setup

Create and activate a Python virtual environment, then install the backend:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .
```

Build the frontend extension from the `ui` directory:

```powershell
npm install
npm run build
```

The build writes ComfyUI web assets to `dist/image_shelf`.

## Standalone Backend

Standalone mode runs the gallery API without starting ComfyUI. Copy `.env.example` to `.env` and set these absolute paths:

```dotenv
COMFYUI_PATH=C:/path/to/ComfyUI
COMFYUI_OUTPUT_FOLDER=C:/path/to/ComfyUI/output
# Optional; defaults to settings.json in the project root
IMAGE_SHELF_SETTINGS_PATH=C:/path/to/image-shelf/settings.json
```

The backend reads and writes gallery settings from `settings.json` in the project root by default. Set `IMAGE_SHELF_SETTINGS_PATH` to use another file. Unknown fields are ignored and invalid known fields are rejected.

It uses `custom_folders` for custom gallery folders. Outputs is the default gallery folder. Start it with:

```powershell
.\.venv\Scripts\python.exe gallery_backend.py
```

By default it listens on `http://127.0.0.1:8189`. When running the Vite frontend in development mode, enable **Image Shelf > Development > Use standalone backend** in ComfyUI settings. Without that switch, Vite proxies Image Shelf API calls to ComfyUI at `http://127.0.0.1:8188`.

## Current Status

The gallery backend currently provides background indexing, SQLite FTS5 search, dimension facets, tag suggestions, secure opaque image URLs, and custom folders. The frontend opens from `Extensions > Image Shelf > Open Image Shelf` and renders folder-scoped image thumbnails.
