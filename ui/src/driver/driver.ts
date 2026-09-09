import type { ComfyApp } from "@comfyorg/comfyui-frontend-types"

import { ToastOptions } from "../lib/toast"

export interface Driver {
  setSetting(key: string, value: unknown): void
  getSetting(key: string): unknown
  addSettingsListener(callback: (payload: { key: string; value: unknown }) => void): void
  removeSettingsListener(callback: (payload: { key: string; value: unknown }) => void): void

  toast(options: ToastOptions): void

  getComfyApp(): ComfyApp
}

let driver: Driver | null = null

export function setDriver(d: Driver) {
  driver = d
}

export function getDriver(): Driver {
  if (!driver) {
    throw new Error("Driver not set")
  }
  return driver
}
