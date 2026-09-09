import mitt from "mitt"
import { toast } from "sonner"

import { Driver, setDriver } from "./driver"

if (!__USE_STANDALONE_BACKEND__) {
  throw new Error("Standalone driver must be used with a standalone backend.")
}

const settings: Record<string, unknown> = {}
const emitter = mitt<{ settingChanged: { key: string; value: unknown } }>()

const standaloneDriver: Driver = {
  // Settings changes in standalone mode won't actually be applied to ComfyUI,
  // and therefore will be reset when the standalone backend restarts.
  setSetting(key, value) {
    settings[key] = value
    emitter.emit("settingChanged", { key, value })
  },
  getSetting(key) {
    return settings[key]
  },
  addSettingsListener(callback) {
    emitter.on("settingChanged", callback)
  },
  removeSettingsListener(callback) {
    emitter.off("settingChanged", callback)
  },
  toast(options) {
    const soonerOptions = {
      description: options.message,
      duration: options.duration,
    }
    switch (options.type) {
      case "success":
        toast.success(options.title, soonerOptions)
        break
      case "error":
        toast.error(options.title, soonerOptions)
        break
      case "warn":
        toast.warning(options.title, soonerOptions)
        break
      default:
        toast(options.title, soonerOptions)
        break
    }
  },
  getComfyApp() {
    throw new Error("Not implemented in standalone driver.")
  },
}

setDriver(standaloneDriver)
