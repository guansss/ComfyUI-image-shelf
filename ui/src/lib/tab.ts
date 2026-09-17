import { getDriver } from "../driver/driver"
import { CUSTOM_FOLDERS_SETTING } from "../global"
import { GalleryFolder } from "../services/gallery"

export interface StoredCustomFolder {
  id: string
  name: string
  path: string
}

export function saveCustomFolders(
  folders: StoredCustomFolder[] | ((prev: StoredCustomFolder[]) => StoredCustomFolder[]),
) {
  if (typeof folders === "function") {
    folders = folders(readCustomFolders())
  }
  getDriver().setSetting(CUSTOM_FOLDERS_SETTING, folders)
}

export function toStoredCustomFolder(folder: GalleryFolder): StoredCustomFolder {
  return {
    id: folder.id,
    name: folder.name,
    path: folder.path,
  }
}

export function readCustomFolders(): StoredCustomFolder[] {
  const value = getDriver().getSetting(CUSTOM_FOLDERS_SETTING)
  if (!Array.isArray(value)) {
    console.warn("[Image Shelf] readCustomFolders: invalid value", value)
    return []
  }
  return value.filter(
    (folder): folder is StoredCustomFolder =>
      typeof folder === "object" &&
      folder !== null &&
      typeof folder.id === "string" &&
      typeof folder.name === "string" &&
      typeof folder.path === "string" &&
      folder.path.trim().length > 0,
  )
}
