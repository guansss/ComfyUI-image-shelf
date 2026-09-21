import { API_ROOT } from "../global"
import { i18n } from "../i18n/i18n"
import { formatError } from "../lib/error"

type ResponseType = "json" | "text" | "ignore"
type CustomResponseHandler<T> = (
  response: Response,
  defaultParser: (responseType?: ResponseType) => Promise<T>,
  defaultErrorHandler: (error?: unknown) => Promise<Error>,
) => Promise<T>

export async function api<T>(
  url: string,
  method: string,
  body?: Record<string, unknown>,
  handler: ResponseType | CustomResponseHandler<T> = "json",
): Promise<T> {
  const normalizedURL = new URL(url, API_ROOT).toString()

  let res: Response
  try {
    res = await fetch(normalizedURL, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    throw new NetworkError(formatError(e))
  }

  const defaultHandler = async (responseType: ResponseType = "json"): Promise<T> => {
    if (res.ok) {
      if (responseType === "ignore") {
        return undefined as T
      }
      if (responseType === "text") {
        return res.text() as T
      }
      return res.json() as T
    } else {
      // Ideally we would make defaultErrorHandler always throw an error (resulting a Promise<never> return type),
      // and just await it here, but TypeScript doesn't interpret that as an unreachable end point,
      // (https://github.com/microsoft/TypeScript/issues/34955)
      // so we have to make it return a Promise<Error> and throw it here instead.
      throw await defaultErrorHandler()
    }
  }
  const defaultErrorHandler = async (error?: unknown): Promise<Error> => {
    if (error !== undefined && error !== null) {
      if (error instanceof Error) {
        return error
      }
      return new APIError(formatError(error), normalizedURL, res.status)
    }

    let message = i18n.error.unknown

    if (!res.bodyUsed) {
      try {
        const contentType = res.headers.get("content-type")

        if (contentType?.includes("application/json")) {
          message = (await res.json()).message
        } else if (contentType?.includes("text/")) {
          message = await res.text()
        }
      } catch (e) {
        console.warn("Could not parse API error.", e)
      }
    }

    return new APIError(message, normalizedURL, res.status)
  }
  if (typeof handler === "function") {
    try {
      return await handler(res, defaultHandler, defaultErrorHandler)
    } catch (e) {
      throw await defaultErrorHandler(e)
    }
  }
  return defaultHandler(handler)
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(`NetworkError: ${message}`)
    this.name = "NetworkError"
  }
}

export class APIError extends Error {
  constructor(
    message: string,
    public url: string,
    public status: number,
  ) {
    super(`APIError: ${message} (url=${url}, status=${status})`)
    this.name = "APIError"
  }
}
