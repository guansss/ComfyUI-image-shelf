import { getDriver } from "../driver/driver"

export interface ToastOptions {
  type: "success" | "info" | "warn" | "error"
  title: string
  message?: string
  duration?: number
}

export function toast(options: ToastOptions) {
  getDriver().toast(options)
}
