import type { ComfyApp } from "@comfyorg/comfyui-frontend-types"

import { getDefaultStore } from "jotai"
import { vi } from "vitest"

import en from "../src/i18n/generated/en"
import { rawTranslationsAtom } from "../src/i18n/i18n"

vi.mock("/scripts/app.js", () => {
  const app = {
    graph: {
      _nodes: [],
    },
    api: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    canvas: {},
  } as any as ComfyApp
  return { app }
})

vi.mock("/scripts/api.js", () => {
  return { api: "NOT IMPLEMENTED" }
})

getDefaultStore().set(rawTranslationsAtom, {
  language: "en",
  data: en,
})
