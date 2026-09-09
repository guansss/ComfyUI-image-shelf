// @ts-expect-error I don't know how to properly get this to work
import { api as _api } from "/scripts/api.js"
// @ts-expect-error I don't know how to properly get this to work
import { app as _app } from "/scripts/app.js"
// This comment prevents the above imports from being messed up by formatters
import { ComfyApi, ComfyApp } from "@comfyorg/comfyui-frontend-types"

import { Driver, setDriver } from "./driver"

const app: ComfyApp = _app
const api: ComfyApi = _api

const comfyDriver: Driver = {
  setSetting(key, value) {
    app.extensionManager.setting.set(key, value)
  },
  getSetting(key) {
    return app.extensionManager.setting.get(key)
  },
  addSettingsListener() {
    throw new Error("Not implemented. Use settings.onChange when registering settings instead.")
  },
  removeSettingsListener() {
    throw new Error("Not implemented. Use settings.onChange when registering settings instead.")
  },
  toast(options) {
    app.extensionManager.toast.add({
      severity: options.type,
      summary: options.title,
      detail: options.message,
      life: options.duration ?? 3000,
      ...options,
    })
  },
  getComfyApp() {
    return app
  },
}

setDriver(comfyDriver)
