import { SetOptional } from "type-fest"

import { i18n, i18nFallback } from "../i18n/i18n"
import { toast, ToastOptions } from "./toast"

export function formatError(e: unknown, fallback?: string): string {
  let str = ""

  if (typeof e === "string") {
    str = e
  } else if (e !== null && typeof e === "object") {
    if ((e as Error).message) {
      str = String((e as Error).message)
    } else {
      str = String(e)
    }
    if (str === "[object Object]") {
      str = ""
    }
  }
  if (i18n.isLoaded) {
    const errorCodes = Object.keys(i18n.error.code)
    for (const code of errorCodes) {
      if (str.includes(`[${code}]`)) {
        return i18n.error.code[code as keyof typeof i18n.error.code]
      }
    }
  }
  return str || fallback || i18nFallback("Unknown error", () => i18n.error.unknown)
}

interface ErrorToastOptions extends SetOptional<Omit<ToastOptions, "type">, "title"> {}

export function errorToast(options: ErrorToastOptions) {
  toast({
    type: "error",
    title: options.title ?? i18nFallback("Error", () => i18n.error.error),
    duration: 5000,
    ...options,
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

export function suppress<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch (e) {
    return undefined
  }
}
