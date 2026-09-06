import mitt, { Emitter } from "mitt"

import { API_ROOT } from "../global"
import { SearchQuery, toBackendSearchTerms } from "../lib/search"
import { api } from "./network"

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
  query: SearchQuery
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
  dimensions: DimensionFacet[]
}

export type GalleryMessage = {
  tabsUpdated: {
    tabs: {
      id: string
      name: string
      folders: string[]
      editable: boolean
      removable: boolean
    }[]
  }
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

export async function fetchTabs(): Promise<{ items: GalleryTab[] }> {
  return await api<{ items: GalleryTab[] }>("tabs", "GET", undefined, "json")
}

export async function fetchImages(imageQuery: ImageQuery): Promise<ImageListResponse> {
  const parameters = new URLSearchParams({
    tab: imageQuery.tab,
    terms: JSON.stringify(toBackendSearchTerms(imageQuery.query.terms)),
    sort: imageQuery.sort,
    direction: imageQuery.direction,
    page: String(imageQuery.page),
    page_size: String(imageQuery.pageSize),
  })
  for (const dimension of imageQuery.dimensions) {
    parameters.append("dimension", dimension)
  }
  return api<ImageListResponse>(`images?${parameters}`, "GET")
}

export async function fetchTagSuggestions(query: string): Promise<{ items: TagSuggestion[] }> {
  const parameters = new URLSearchParams({ q: query })
  return api<{ items: TagSuggestion[] }>(`tags?${parameters}`, "GET")
}

export function fetchImageDetails(imageId: string): Promise<ImageDetails> {
  return api<ImageDetails>(`images/${encodeURIComponent(imageId)}`, "GET")
}

export async function sendToFavorites(
  imageId: string,
  filename?: string,
): Promise<{ filename: string; mode: string }> {
  return await api(
    `images/${encodeURIComponent(imageId)}/favorite`,
    "POST",
    { mode: "copy", filename },
    async (res, defaultHandler) => {
      if (res.status === 409) {
        const payload: { suggested_filename: string } = await res.json()
        throw new FavoriteConflictError(payload.suggested_filename)
      }
      return defaultHandler("json")
    },
  )
}

export async function reindexTab(tab: string): Promise<void> {
  return await api(`reindex?${new URLSearchParams({ tab })}`, "POST", undefined, "ignore")
}

export async function revealImage(imageId: string): Promise<void> {
  return await api(`images/${encodeURIComponent(imageId)}/reveal`, "POST", undefined, "ignore")
}

export async function pickFolder(): Promise<void> {
  return await api(`pick-folder`, "POST", undefined, "ignore")
}

export async function updateSettings(patch: Record<string, unknown>): Promise<void> {
  return await api(`settings`, "POST", patch, "ignore")
}
