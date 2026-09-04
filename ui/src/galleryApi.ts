import mitt, { Emitter } from "mitt"

import { API_ROOT } from "./global"

export interface GalleryTab {
  id: string
  name: string
  folders: string[]
  editable: boolean
  removable: boolean
  indexing: boolean
  count: number
  error: string | null
}

export interface GalleryImage {
  id: string
  filename: string
  extension: string
  width: number
  height: number
  file_size: number
  created_at: number
  parse_error: string | null
  url: string
}

export interface DimensionFacet {
  width: number
  height: number
  count: number
}

export interface TagSuggestion {
  name: string
  type: "positive" | "negative"
}

export interface ImageDetails {
  id: string
  filename: string
  extension: string
  width: number
  height: number
  file_size: number
  created_at: number
  parse_error: string | null
  tags: string[]
  negative_tags: string[]
}

export class FavoriteConflictError extends Error {
  constructor(public readonly suggestedFilename: string) {
    super("A file with that name already exists in Favorites.")
  }
}

export interface ImageQuery {
  tab: string
  query: string
  dimensions: string[]
  sort: "created_at" | "filename"
  direction: "asc" | "desc"
  page: number
  pageSize: number
}

export interface ImageListResponse {
  items: GalleryImage[]
  page: number
  page_size: number
  total: number
}

export type GalleryMessage = {
  indexStart: {
    tab: string
  }
  indexFinish: {
    tab: string
    error?: string
    result?: {
      indexed: number
      skipped: number
      removed: number
      errors: number
    }
  }
  pickFolder: {
    path?: string | null
    error?: string
  }
}

interface GalleryMessageEvent {
  event: string
  data: unknown
}

function isGalleryMessageEvent(value: unknown): value is GalleryMessageEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "event" in value &&
    typeof value.event === "string" &&
    "data" in value
  )
}

// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
export interface GalleryWebSocket extends Emitter<GalleryMessage> {}

export class GalleryWebSocket {
  private socket: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private isClosing = false

  constructor() {
    Object.assign(this, mitt<GalleryMessage>())
  }

  connect(): void {
    if (this.socket || this.isClosing) return
    const websocket = new WebSocket(this.websocketUrl())
    this.socket = websocket
    websocket.onopen = () => {
      console.log("Connected to gallery WebSocket.")
      if (this.socket !== websocket) return
      this.reconnectDelay = 1000
    }
    websocket.onmessage = (event) => {
      if (this.socket !== websocket) return
      try {
        const message: unknown = JSON.parse(event.data)
        if (isGalleryMessageEvent(message)) {
          ;(this as unknown as Emitter<Record<string, unknown>>).emit(message.event, message.data)
        }
      } catch {
        // Ignore malformed messages from the backend.
      }
    }
    websocket.onerror = () => websocket.close()
    websocket.onclose = () => {
      if (this.socket !== websocket) return
      this.socket = null
      if (!this.isClosing) this.scheduleReconnect()
    }
  }

  disconnect(): void {
    this.isClosing = true
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.socket?.close()
    this.socket = null
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
      this.connect()
    }, this.reconnectDelay)
  }

  private websocketUrl(): string {
    const url = new URL(API_ROOT)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    url.pathname = `${url.pathname.replace(/\/$/, "")}/websocket`
    return url.toString()
  }
}

export const socket = new GalleryWebSocket()
socket.connect()

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, { signal })
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<T>
}

async function post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  })
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<T>
}

export async function fetchTabs(signal?: AbortSignal): Promise<GalleryTab[]> {
  const response = await get<{ items: GalleryTab[] }>("/tabs", signal)
  return response.items
}

export async function fetchImages(
  imageQuery: ImageQuery,
  signal?: AbortSignal,
): Promise<ImageListResponse> {
  const parameters = new URLSearchParams({
    tab: imageQuery.tab,
    query: imageQuery.query,
    sort: imageQuery.sort,
    direction: imageQuery.direction,
    page: String(imageQuery.page),
    page_size: String(imageQuery.pageSize),
  })
  for (const dimension of imageQuery.dimensions) {
    parameters.append("dimension", dimension)
  }
  return get<ImageListResponse>(`/images?${parameters}`, signal)
}

export async function fetchDimensions(
  tab: string,
  query: string,
  signal?: AbortSignal,
): Promise<DimensionFacet[]> {
  const parameters = new URLSearchParams({ tab, query })
  const response = await get<{ items: DimensionFacet[] }>(`/dimensions?${parameters}`, signal)
  return response.items
}

export async function fetchTagSuggestions(
  tab: string,
  query: string,
  signal?: AbortSignal,
): Promise<TagSuggestion[]> {
  const parameters = new URLSearchParams({ tab, q: query })
  const response = await get<{ items: TagSuggestion[] }>(`/tags?${parameters}`, signal)
  return response.items
}

export function fetchImageDetails(imageId: string, signal?: AbortSignal): Promise<ImageDetails> {
  return get<ImageDetails>(`/images/${encodeURIComponent(imageId)}`, signal)
}

export async function sendToFavorites(
  imageId: string,
  filename?: string,
): Promise<{ filename: string; mode: string }> {
  const response = await fetch(`${API_ROOT}/images/${encodeURIComponent(imageId)}/favorite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "copy", filename }),
  })
  if (response.status === 409) {
    const payload = (await response.json()) as { suggested_filename: string }
    throw new FavoriteConflictError(payload.suggested_filename)
  }
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<{ filename: string; mode: string }>
}

export async function reindexTab(tab: string): Promise<void> {
  return await post(`/reindex?${new URLSearchParams({ tab })}`)
}

export async function revealImage(imageId: string): Promise<void> {
  return await post(`/images/${encodeURIComponent(imageId)}/reveal`)
}

export async function pickFolder(): Promise<void> {
  return await post(`/pick-folder`)
}
