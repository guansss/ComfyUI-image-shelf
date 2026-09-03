export const EXTENSION_ID = "comfyui-image-shelf"
export const SERVER_URL = new URL(__BACKEND_BASE_URL__, window.location.origin).toString()
export const API_ROOT = new URL("/api/image-shelf/v1", SERVER_URL).toString()
export const CUSTOM_TABS_SETTING = "image-shelf.custom-tabs"
export const FAVORITES_SETTING = "image-shelf.favorites-folder"

export const Z_POPOVER = "z-2000"

export const rootContainer = document.createElement("div")
rootContainer.id = "image-shelf-root"
rootContainer.className = "dark pointer-events-auto"
document.body.appendChild(rootContainer)

export const portalRoot = rootContainer
