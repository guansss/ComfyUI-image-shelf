import { atom, SetStateAction } from "jotai"
import { atomWithStorage } from "jotai/utils"

interface Config {
  pageSize: number
}

const defaultConfig: Config = {
  pageSize: 36,
}

const localConfigAtom = atomWithStorage<Partial<Config>>("image-shelf.config", {}, undefined, {
  getOnInit: true,
})
export const configAtom = atom(
  (get) => ({
    ...defaultConfig,
    ...get(localConfigAtom),
  }),
  (get, set, update: SetStateAction<Partial<Config>>) => {
    if (typeof update === "function") {
      update = update(get(configAtom))
    }
    set(localConfigAtom, (prev) => ({ ...prev, ...update }))
  },
)
