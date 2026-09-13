export const EXTENSION_ID = "comfyui-image-shelf"
export const SERVER_URL =
  typeof window !== "undefined"
    ? new URL(__BACKEND_BASE_URL__, window.location.origin).toString()
    : __BACKEND_BASE_URL__
export const API_ROOT = new URL("/api/image-shelf/v1/", SERVER_URL).toString()
export const CUSTOM_TABS_SETTING = "image-shelf.custom-tabs"
export const FAVORITES_SETTING = "image-shelf.favorites-folder"
