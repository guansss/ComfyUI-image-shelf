import { atom, SetStateAction } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { defaults } from "lodash-es"
import { PartialDeep } from "type-fest"

interface Config {
  gallery: GalleryConfig
  promptDisplayMode: "tags" | "raw" | "both"
  theme: "light" | "dark"
}

interface GalleryConfig {
  activeFolder: string
  query: string
  pageSize: number
  sort: "created_at" | "filename"
  direction: "asc" | "desc"
  groupByDay: boolean
}

const defaultConfig: Config = {
  gallery: {
    activeFolder: "outputs",
    query: "",
    pageSize: 36,
    sort: "created_at",
    direction: "desc",
    groupByDay: true,
  },
  promptDisplayMode: "both",
  theme: "dark",
}

const localConfigAtom = atomWithStorage<PartialDeep<Config>>("image-shelf.config", {}, undefined, {
  getOnInit: true,
})
export const configAtom = atom(
  (get): Config =>
    defaults(
      { gallery: defaults({}, get(localConfigAtom).gallery, defaultConfig.gallery) },
      get(localConfigAtom),
      defaultConfig,
    ),
  (get, set, update: SetStateAction<PartialDeep<Config>>) => {
    if (typeof update === "function") {
      update = update(get(configAtom))
    }
    set(localConfigAtom, (prev) => ({
      ...prev,
      ...update,
      gallery: { ...prev.gallery, ...update.gallery },
    }))
  },
)

export const galleryConfigAtom = atom(
  (get) => get(configAtom).gallery,
  (get, set, update: SetStateAction<Partial<GalleryConfig>>) => {
    if (typeof update === "function") {
      update = update(get(galleryConfigAtom))
    }
    set(configAtom, { gallery: update })
  },
)
