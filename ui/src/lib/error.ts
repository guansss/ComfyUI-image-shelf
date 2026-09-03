import { app } from "../comfy"
import { i18n } from "../i18n/i18n"

export function formatError(e: unknown, fallback = i18n.error.unknown): string {
  if (typeof e === "string") {
    return e || fallback
  }

  if (e !== null && typeof e === "object") {
    if ((e as Error).message) {
      return (e as Error).message
    }

    const str = String(e)
    return str === "[object Object]" ? fallback : str
  }

  return fallback
}

interface ErrorToastOptions {
  title?: string
  message: string
}

export function errorToast(options: ErrorToastOptions) {
  app.extensionManager.toast.add({
    severity: "error",
    summary: options.title ?? i18n.error.error,
    detail: options.message,
    life: 5000,
  })
}

export const withErrorToast = <T>(
  promise: Promise<T>,
  formatter: string | ((error: unknown) => ErrorToastOptions),
): Promise<T> => {
  return promise.catch((error) => {
    errorToast(
      typeof formatter === "function"
        ? formatter(error)
        : {
            title: formatter,
            message: formatError(error),
          },
    )
    return Promise.reject(error)
  })
}
