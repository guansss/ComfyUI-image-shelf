import { app } from "../comfy"

export interface ToastOptions {
  type: "success" | "info" | "warn" | "error"
  title: string
  message?: string
  duration?: number
}

export function toast(options: ToastOptions) {
  app.extensionManager.toast.add({
    severity: options.type,
    summary: options.title,
    detail: options.message,
    life: options.duration ?? 3000,
    ...options,
  })
}
