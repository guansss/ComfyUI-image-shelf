import { app } from "../comfy"
import { i18n } from "../i18n/i18n"

export function formatError(e: unknown, fallback = i18n.error.unknown): string {
  let str = fallback

  if (typeof e === "string") {
    str = e
  } else if (e !== null && typeof e === "object") {
    if ((e as Error).message) {
      str = String((e as Error).message)
    } else {
      str = String(e)
    }
    if (str === "[object Object]") {
      str = fallback
    }
  }
  const errorCodes = Object.keys(i18n.error.code)
  for (const code of errorCodes) {
    if (str.includes(`[${code}]`)) {
      return i18n.error.code[code as keyof typeof i18n.error.code]
    }
  }
  return str || fallback
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
