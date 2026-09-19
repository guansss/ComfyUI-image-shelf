import { atom, getDefaultStore } from "jotai"

import { fetchSettings, updateSettings } from "../services/gallery"

export interface CustomFolderSetting {
  id: string
  name: string
  path: string
}

export interface ImageShelfSettings {
  custom_folders?: CustomFolderSetting[]
}

const internalSettingsAtom = atom<ImageShelfSettings>({})

export const settingsAtom = atom(
  (get) => get(internalSettingsAtom),
  async (
    get,
    set,
    update:
      | Partial<ImageShelfSettings>
      | ((prev: ImageShelfSettings) => Partial<ImageShelfSettings> | undefined),
  ) => {
    const prevSettings = get(internalSettingsAtom)
    if (typeof update === "function") {
      const result = update(prevSettings)
      if (!result) return
      update = result
    }
    const updated = await updateSettings(update)
    set(internalSettingsAtom, updated)
  },
)

export async function initializeSettings(): Promise<void> {
  const settings = await fetchSettings()
  getDefaultStore().set(internalSettingsAtom, settings)
}

export function getSettings(): ImageShelfSettings {
  return getDefaultStore().get(internalSettingsAtom)
}
