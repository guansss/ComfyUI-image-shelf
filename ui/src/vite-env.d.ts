/// <reference types="vite/client" />

interface ImportMeta {
  env: {
    DEV: boolean
    PROD: boolean
    MODE: string
  }
}

declare const __BACKEND_BASE_URL__: string
declare const __USE_STANDALONE_BACKEND__: boolean
