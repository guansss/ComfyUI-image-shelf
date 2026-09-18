import { GalleryFolder } from "../services/gallery"
import { CustomFolderSetting } from "./settings"

export function toStoredCustomFolder(folder: GalleryFolder): CustomFolderSetting {
  return {
    id: folder.id,
    name: folder.name,
    path: folder.path,
  }
}

export function moveCustomFolder(
  folders: CustomFolderSetting[],
  folderId: string,
  direction: "up" | "down",
): CustomFolderSetting[] {
  const folderIndex = folders.findIndex((folder) => folder.id === folderId)
  const destinationIndex = folderIndex + (direction === "up" ? -1 : 1)
  if (folderIndex < 0 || destinationIndex < 0 || destinationIndex >= folders.length) {
    return folders
  }
  const nextFolders = [...folders]
  ;[nextFolders[folderIndex], nextFolders[destinationIndex]] = [
    nextFolders[destinationIndex],
    nextFolders[folderIndex],
  ]
  return nextFolders
}
