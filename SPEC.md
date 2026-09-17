## Goal

Build a ComfyUI extension (custom node) that allows users to easily browse and manage generated images within the ComfyUI interface.

## Features

- **Image Gallery**: A pop-up gallery that displays generated images, allowing users to search, filter, and sort images based on various criteria.
- **"Save as JPEG" node**: A node that allows users to save images in JPEG format.
- **"Send to Favorites" node**: A node that allows users to copy/move saved images to a configurable "Favorites" folder.

## Tech Stack

- Frontend: Vite, React, shadcn/ui, TailwindCSS (use inline classes as much as possible)
- Backend: Python, ComfyUI, aiohttp, Pillow, SQLite + FTS5

## UX Design

### Image Gallery

The Image Gallery is a pop-up component that can be triggered via a button in ComfyUI's [topbar menu](https://docs.comfy.org/custom-nodes/js/javascript_topbar_menu).

#### Toolbar

The gallery will include a toolbar with:

- A search bar. (See "Search" section below)
- Filtering and sorting options. (See "Filtering and Sorting" section below)

#### Folders

- The gallery will include folders for different categories of images.
- **Outputs** is the only default folder and displays all generated images in ComfyUI's output folder.
- Users will be able to add custom folders by clicking an "Add Folder" button and selecting a local folder. Each custom folder has exactly one required path and is saved to the [settings](https://docs.comfy.org/custom-nodes/js/javascript_settings) under `image-shelf.custom-folders`.
- Multiple folders can point to the same path, and the gallery will index that path only once. The gallery will de-duplicate images based on their full path, so if the same image exists in multiple folders, it will only be displayed once in the gallery.
- Each folder will display the number of images it contains, or a loading indicator if the indexing process is ongoing.
- Each folder will have a dropdown menu with options to:
  - Re-index the folder (see "Indexing" section below)
  - Rename the folder
  - Change the folder path (custom folders only)
  - Remove the folder (custom folders only)

#### Image Grid

- The gallery will display a grid of images.
- The images to display will be filtered based on the selected folder, search query, and filter/sort options.
- The grid will support pagination to handle large numbers of images efficiently.
- The grid columns will be responsive, adjusting the number of columns based on the screen size.
- The grid will categorize images into sections based on their creation day. This feature can be toggled on/off by the user.
- Each image will have a dropdown menu with options to:
  - Reveal the image in the file explorer
  - Load the image's workflow in ComfyUI
  - Send the image to the configured "Favorites" destination
- The gallery will display a loading state while fetching images from the backend or the indexing process is ongoing.

#### Filtering and Sorting

- Filtering options:
  - **Dimensions**: fetched from backend according to the selected tab, including counts, e.g., "512x512 (10)", "1024x768 (5)", and sorted by count descending. Supports multi-select.
- Sorting options (newest creation date first by default):
  - **Filename**: ascending/descending
  - **Creation date**: newest/oldest

#### Search

- A search bar will be provided to allow users to search for images by filename or tags.
- The search will support auto-complete to suggest matching tags as the user types.
- An expandable comment section will be provided below the search bar to explain the search syntax and provide examples.

#### Image Viewer

- Clicking on an image in the grid will open a modal viewer that displays the full-size image.
- The viewer will include navigation controls (buttons and keyboard shortcuts) to move between images in the gallery.
- The viewer will also display image metadata on the side, including:
  - Filename (full path)
  - Creation date
  - Dimensions
  - File size
  - Tags
- The viewer will include options to:
  - Reveal the image in the file explorer
  - Load the image's workflow in ComfyUI
  - Send the image to the configured "Favorites" destination

### "Save as JPEG" Node

- The "Save as JPEG" node will allow users to save images in JPEG format.
- The node will have an "Image" type input and an "Image" type output, exactly the same as ComfyUI's "Save Image" node.
- The node will have options to configure the JPEG quality and output folder.

### "Send to Favorites" Node

- The "Send to Favorites" node will allow users to copy/move saved images to a user-configured "Favorites" folder.
- The node will have an "Image" type input and an "Image" type output. The image will be passed through the node without modification.
- The node will require ComfyUI's "Save Image" node as its input node, and will hijack the input node's `node.onExecuted` callback to retrieve the saved image's path for processing.
- The node will have an option to toggle between "copy" and "move" modes.
- The node will have a "Send" button that will immediately trigger the copying/moving operation according to the selected mode.
- When the operation is complete, a notification will be displayed through ComfyUI's [Toast API](https://docs.comfy.org/custom-nodes/js/javascript_toast).
- When the operation fails, an error message will be displayed through the Toast API.

### Settings

- The extension will register a settings category through ComfyUI's [settings API](https://docs.comfy.org/custom-nodes/js/javascript_settings).
- The settings will allow users to configure:
  - The "Favorites" folder
- The settings will include the following "hidden" options for storing user configurations from other parts of the UI:
  - Custom folders (one required path per folder)
  - Last used search query
  - Last used filter and sort options

## Implementation Details

### General Requirements

- All image listing, filtering, sorting, searching, and pagination must be
  performed server-side.
- The frontend must never access arbitrary filesystem paths directly.
- The backend must only serve files belonging to configured/tracked folders.
- Indexing must not block ComfyUI's HTTP request handling or frontend UI.
- Multiple folders referring to the same path must share a single index.
- File-system paths must be normalized before being stored or compared.
- The implementation must handle files being created, modified, renamed,
  or deleted while indexing.
- All filesystem and metadata parsing errors must be handled gracefully
  without aborting the entire indexing process.

### Standalone Backend for Image Gallery

For development purposes, the image gallery's backend will be implemented in a way that allows it to be run as a standalone process.

A `gallery_backend.py` script will be provided that can be run independently of ComfyUI. This script will start an aiohttp server that serves the gallery's API endpoints and handles image indexing, searching, and metadata parsing.

A `.env` file will be used to provide ComfyUI's installation path and the output folder path to the standalone backend.

The frontend, when launched in development mode, will add a "Debug" switch to the settings page that allows users to connect the frontend to the standalone backend instead of ComfyUI's backend. This will allow developers to test the gallery without needing to reboot ComfyUI.

### API Endpoints

The backend will provide API endpoints to:

- Fetch the list of images with metadata for a specific folder, with support for filtering, sorting, and pagination. A URL will be provided for each image for displaying in the frontend. The URL will be generated by the backend based on served static files, and will not expose the actual filesystem path.
- Fetch the list of available filtering options (e.g., dimensions) for a specific folder.
- Fuzzy search for tags (including negative tags) for providing auto-complete suggestions in the gallery's search bar.
- Update the user's custom folders, which can be called when the user adds or removes a custom folder.
- Trigger re-indexing of a specific folder.
- Check the indexing status for each folder, which can be called when the gallery is opened or when the user triggers a re-indexing operation.

### Tag Parsing

Tags will be parsed from the ComfyUI workflow that generated the image.

Steps:

1. Read the workflow JSON from the image's metadata.
   - For a PNG image, the workflow JSON can be read with `image.info['workflow']` using Pillow.
   - For a JPEG image, the workflow JSON can be read from the `UserComment` EXIF tag.
2. Look into the workflow's nodes list (`workflow['nodes']`) and find the first node with a `title` string field containing `"prompt"` (case-insensitive) and the first node with a `title` string field containing `"negative prompt"` (case-insensitive).
3. Extract the prompt/negative prompt text with `node['widgets_values'][0]`.
4. Parse the tags from the prompt/negative prompt text using the following steps:
   1. Convert the text to lowercase.
   2. Unwrap keywords from wrapping parentheses and numeric weights if any. For example, `(cat:1.2), (cute, playful: 0.8), (outdoor), blue sky` will be unwrapped to `cat, cute, playful, outdoor, blue sky`.
   3. Split the text by commas, trim whitespace and discard empty strings.
   4. Remove duplicates.
5. Store the resulting tags (from prompt) and negative tags (from negative prompt) in the SQLite database for indexing and searching.

If the parsing fails, an error message will be stored in the database for that image, and the gallery will display a warning icon next to the image in the grid. Opening the image in the viewer will display the error message in the metadata section.

For other image formats, the extension will not attempt to extract tags. These kind of images will be displayed in the gallery with a question mark icon next to them, and cannot be searched by tags. Opening the image in the viewer will display a message in the metadata section indicating that the image format is unsupported.

### Indexing

On startup, the extension will scan the tracked folders for images and index their metadata in the SQLite database. The indexing process will be run as a background task to avoid blocking the main thread.

The extension will monitor the tracked folders for changes (new images, deleted images, modified images) and update the index accordingly. The indexing process will be optimized to handle large numbers of images efficiently.

The tracked folders will include:

- ComfyUI's output folder
- Other folders added through the gallery's custom folders

Images that cannot be opened by Pillow will be skipped and ignored.

"Creation date" refers to the timestamp of the image file's creation time on disk.

When a custom folder is added, the extension will immediately index the folder.

When a custom folder is removed, the extension will stop monitoring the folder and remove all associated records from the database if the folder is not being tracked by any other folder.

The output folder can be read with ComfyUI's `folder_paths.get_output_directory()` (https://github.com/Comfy-Org/ComfyUI/blob/master/folder_paths.py). In standalone mode, the extension will read the output folder path from the `.env` file instead.

### Database Schema

```
images
------
id
path
filename
extension
width
height
file_size
created_at
mtime
workflow
parse_error

tags
----
id
name
normalized_name
type

image_tags
----------
image_id
tag_id

tabs
----
id
name
folder_path
```

And an FTS table for searchable text.

### Searching

The search functionality will be implemented using SQLite. The full-text search part will be implemented using SQLite's FTS5 extension.

The search query will be broken down into keywords with the following syntax:

| Syntax       | Meaning                                      |
| ------------ | -------------------------------------------- |
| `cat`        | positive prompt tag `cat`                    |
| `tag:cat`    | positive prompt tag `cat`                    |
| `tag:-cat`   | negative-prompt tag `cat`                    |
| `-tag:cat`   | exclude images containing positive tag `cat` |
| `-tag:-cat`  | exclude images containing negative tag `cat` |
| `name:foo`   | filename contains `foo`                      |
| `prompt:foo` | prompt/negative prompt full-text search      |

The search will support combining multiple search terms with spaces, which will be treated as an AND operation. For example, `tag:cat tag:outdoor` will search for both the "cat" and "outdoor" tags.

If a search term contains spaces, it should be enclosed in double quotes. For example, `tag:"orange cat"` will search for the tag "orange cat".

If a keyword has no prefix, it will be treated as a search for tags. For example, `cat` will search for the "cat" tag, `tag:orange cat` will search for both the "orange" and "cat" tags.

### Storing Metadata for JPEG

ComfyUI only officially supports the PNG format. It stores the workflow JSON in the PNG's metadata, and reads it back when loading the image. To provide similar functionality for JPEG images, the extension will store and read the workflow JSON in the JPEG's `UserComment` EXIF tag.

The "Save as JPEG" node can get the workflow JSON from the [`EXTRA_PNGINFO` hidden input](https://docs.comfy.org/custom-nodes/backend/more_on_inputs#extra_pnginfo).

### Handling File Conflicts

When saving an image to the "Favorites" folder, if a file with the same name already exists, the extension will prompt the user to choose one of the following options:

- Rename the new file. An input field will be provided with a suggested new filename that is generated by appending a number to the original filename (e.g., `image_1.jpg`, `image_2.jpg`, etc.) and ensured to be unique in the destination folder.
- Cancel the operation.

### Reading Settings

On startup, the extension will load the initial settings by sending a request to ComfyUI's [settings API endpoint](https://github.com/Comfy-Org/ComfyUI/blob/master/app/app_settings.py).

To react to changes in the settings, the extension's frontend will listen for the `settings_changed` event emitted by ComfyUI's frontend, and when this event is received, it will notify the backend to reload the settings. The backend will then load the latest settings and determine if anything should be updated (e.g., if a custom folder has changed, the backend will re-index the new folder).

In standalone mode, the extension will read the settings from `<ComfyUI installation path>/user/default/comfy.settings.json` instead.

## Development

### Environment

Development will be done in a Python venv environment to isolate dependencies.

Frontend development will be done in the `ui` folder.

### Initial Implementation

The current state of the repository is based on the ComfyUI React Extension Template. The following steps should be performed to migrate from the template to the final implementation:

- Change all the "template" placeholders to actual meaningful names.
- Remove debugging logging and console statements.

## References

- [ComfyUI Custom Nodes Documentation](https://docs.comfy.org/custom-nodes/overview)
- [ComfyUI Frontend](https://github.com/Comfy-Org/ComfyUI_frontend)
