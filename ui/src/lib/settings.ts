import { atom, getDefaultStore } from "jotai"
import { z } from "zod"

import { fetchSettings, updateSettings } from "../services/gallery"
import { uuidv4 } from "../utils/lang"

export interface CustomFolderSetting {
  id: string
  name: string
  path: string
}

const promptHintKindSchema = z.enum(["text", "conditioning"])
const promptHintRoleSchema = z.enum(["positive", "negative", "unknown"])

export type PromptHintKind = z.infer<typeof promptHintKindSchema>
export type PromptHintRole = z.infer<typeof promptHintRoleSchema>

export const promptHintSchema = z.object({
  class_type: z.string().trim().min(1),
  input_name: z.string().trim().min(1),
  kind: promptHintKindSchema,
  role: promptHintRoleSchema,
  ignore: z.boolean(),
  id: z.string(),
})

export const promptHintsSchema = z.array(promptHintSchema)

export type PromptHintSetting = z.infer<typeof promptHintSchema>

export function createPromptHint(): PromptHintSetting {
  return {
    id: `hint-${uuidv4()}`,
    class_type: "",
    kind: "text",
    input_name: "",
    role: "unknown",
    ignore: false,
  }
}

export interface ImageShelfSettings {
  custom_folders?: CustomFolderSetting[]
  thumbnail_cache_max_bytes?: number
  prompt_hints?: PromptHintSetting[]
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
