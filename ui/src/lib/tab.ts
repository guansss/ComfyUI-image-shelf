import { getDriver } from "../driver/driver"
import { CUSTOM_TABS_SETTING } from "../global"
import { GalleryTab } from "../services/gallery"

export interface StoredCustomTab {
  id: string
  name: string
  folder: string
}

export function saveCustomTabs(
  tabs: StoredCustomTab[] | ((prev: StoredCustomTab[]) => StoredCustomTab[]),
) {
  if (typeof tabs === "function") {
    tabs = tabs(readCustomTabs())
  }
  getDriver().setSetting(CUSTOM_TABS_SETTING, tabs)
}

export function toStoredCustomTab(tab: GalleryTab): StoredCustomTab {
  return {
    id: tab.id,
    name: tab.name,
    folder: tab.folders[0] ?? "",
  }
}

export function readCustomTabs(): StoredCustomTab[] {
  const value = getDriver().getSetting(CUSTOM_TABS_SETTING)
  if (!Array.isArray(value)) {
    console.warn("[Image Shelf] readCustomTabs: invalid value", value)
    return []
  }
  return value
}
