export const EXTENSION_ID = "comfyui-image-shelf"
export const COMFY_API_ROOT = "/api/image-shelf/v1"
export const STANDALONE_API_ROOT = "http://127.0.0.1:8189/api/image-shelf/v1"
export const CUSTOM_TABS_SETTING = "image-shelf.custom-tabs"
export const FAVORITES_SETTING = "image-shelf.favorites-folder"

export const Z_POPOVER = "z-2000"

export const rootContainer = document.createElement("div")
rootContainer.id = "image-shelf-root"
rootContainer.className = "dark pointer-events-auto"
document.body.appendChild(rootContainer)

export const portalRoot = rootContainer
