import mitt, { Emitter } from "mitt"

import { API_ROOT } from "../global"
import { SearchQuery, toBackendSearchTerms } from "../lib/search"
import { ImageShelfSettings } from "../lib/settings"
import { api } from "./network"

export interface GalleryFolder {
  id: string
  name: string
  path: string
  editable: boolean
  removable: boolean
  indexing: boolean
  count: number
  error: string | null
}

export interface AppInfo {
  database_path: string
  database_size: number
  settings_path: string
  thumbnail_cache: {
    bytes: number
    files: number
    max_bytes: number
  }
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
  thumbnail_url: string | null
}

export interface DimensionFacet {
  width: number
  height: number
  count: number
}

export interface TagSuggestion {
  name: string
  type: "positive" | "negative"
  count: number
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
  tags: TagSuggestion[]
  metadata: ImageMetadata | null
}

export interface ImageMetadata {
  type: string | null
  info: string | Record<string, any> | null
  normalized_info: string | null
  prompt: PromptParseResult | Record<string, string> | null
  tags: string[]
  negative_tags: string[]
  parse_error: string | null
}

export interface PromptParseResult {
  matches: PromptMatch[]
}

interface PromptMatch {
  text: string
  node_id: string
  class_type: string
  input_name: string
  role: PromptRole
  score: number
  reason: string
  path: PathStep[]
}

interface PathStep {
  node_id: string
  output_index: number | null
  input_name: string
}

type PromptRole = "positive" | "negative" | "unknown"

export class TransferConflictError extends Error {
  constructor(public readonly suggestedFilename: string) {
    super("A file with that name already exists in the target folder.")
  }
}

export interface TransferConflict {
  image_id: string
  filename: string
  suggested_filename: string
}

export class TransferConflictsError extends Error {
  constructor(public readonly conflicts: TransferConflict[]) {
    super("One or more files already exist in the target folder.")
  }
}

export interface ImageQuery {
  folder: string
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
  elapsed: number
}

export type GalleryMessage = {
  foldersUpdated: {
    folders: {
      id: string
      name: string
      path: string
      editable: boolean
      removable: boolean
    }[]
  }
  indexStart: {
    folder: string
  }
  indexFinish: {
    folder: string
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

export async function fetchFolders(): Promise<{ items: GalleryFolder[] }> {
  return await api<{ items: GalleryFolder[] }>("folders", "GET", undefined, "json")
}

export async function fetchImages(imageQuery: ImageQuery): Promise<ImageListResponse> {
  const parameters = new URLSearchParams({
    folder: imageQuery.folder,
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

export async function fetchTagSuggestions(
  query: string | undefined,
  limit = 10,
): Promise<{ items: TagSuggestion[] }> {
  const parameters = new URLSearchParams({ limit: String(limit) })
  if (query) parameters.append("q", query)
  return api<{ items: TagSuggestion[] }>(`tags?${parameters}`, "GET")
}

export function fetchImageDetails(imageId: string): Promise<ImageDetails> {
  return api<ImageDetails>(`images/${encodeURIComponent(imageId)}`, "GET")
}

export type TransferMode = "copy" | "move"
export type TransferConflictMode = "rename" | "suggest" | "fail"

export interface TransferResult {
  folder: string
  filename: string
  mode: TransferMode
}

export interface BatchTransferResult {
  folder: string
  mode: TransferMode
  items: { image_id: string; filename: string }[]
}

export interface AssetTransferItem {
  filename: string
  subfolder?: string
  type?: string
}

export interface AssetTransferResult {
  folder: string
  mode: TransferMode
  items: { item: AssetTransferItem; filename: string }[]
}

export async function transferImage(
  imageId: string,
  folder: string,
  mode: TransferMode,
  filename?: string,
  conflict: TransferConflictMode = "suggest",
): Promise<TransferResult> {
  return await api(
    `images/${encodeURIComponent(imageId)}/transfer`,
    "POST",
    { folder, mode, filename, conflict },
    async (res, defaultHandler) => {
      if (res.status === 409) {
        const payload: { suggested_filename: string } = await res.json()
        throw new TransferConflictError(payload.suggested_filename)
      }
      return defaultHandler("json")
    },
  )
}

export async function transferImages(
  imageIds: string[],
  folder: string,
  mode: TransferMode,
  conflict: TransferConflictMode = "suggest",
  filenames?: Record<string, string>,
): Promise<BatchTransferResult> {
  return await api(
    "batch/images/transfer",
    "POST",
    { image_ids: imageIds, folder, mode, conflict, filenames },
    async (res, defaultHandler) => {
      if (res.status === 409) {
        const payload: {
          error: string
          conflicts?: TransferConflict[]
        } = await res.json()
        if (payload.conflicts) {
          throw new TransferConflictsError(payload.conflicts)
        }
      }
      return defaultHandler("json")
    },
  )
}

export async function transferAssets(
  items: AssetTransferItem[],
  folder: string,
  mode: TransferMode,
  conflict: TransferConflictMode = "suggest",
): Promise<AssetTransferResult> {
  return await api(
    "assets/transfer",
    "POST",
    { items, folder, mode, conflict },
    async (res, defaultHandler) => {
      if (res.status === 409) {
        const payload: {
          error: string
          conflicts?: {
            item: AssetTransferItem
            filename: string
            suggested_filename: string
          }[]
        } = await res.json()
        if (payload.conflicts) {
          throw new TransferConflictsError(
            payload.conflicts.map((conflict) => ({
              image_id: JSON.stringify(conflict.item),
              filename: conflict.filename,
              suggested_filename: conflict.suggested_filename,
            })),
          )
        }
      }
      return defaultHandler("json")
    },
  )
}

export async function reindexFolder(folder: string, force: boolean): Promise<void> {
  return await api(
    `reindex?${new URLSearchParams({ folder, force: String(force) })}`,
    "POST",
    undefined,
    "ignore",
  )
}

export async function revealImage(imageId: string): Promise<void> {
  return await api(`images/${encodeURIComponent(imageId)}/reveal`, "POST", undefined, "ignore")
}

export async function pickFolder(): Promise<void> {
  return await api(`pick-folder`, "POST", undefined, "ignore")
}

/**
 * This api should only be used in standalone mode.
 */
export async function fetchSettings(): Promise<ImageShelfSettings> {
  return await api<ImageShelfSettings>(`settings`, "GET")
}

export async function fetchAppInfo(): Promise<AppInfo> {
  return await api<AppInfo>(`info`, "GET")
}

export async function clearThumbnailCache(): Promise<void> {
  await api(`thumbnail-cache/clear`, "POST", undefined, "ignore")
}

export async function updateSettings(
  patch: Partial<ImageShelfSettings>,
): Promise<ImageShelfSettings> {
  return await api<ImageShelfSettings>(`settings`, "POST", patch)
}
