export interface GalleryTab {
  id: string
  name: string
  configured: boolean
  editable: boolean
  removable: boolean
  indexing: boolean
  count: number
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

async function request<T>(apiRoot: string, path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${apiRoot}${path}`, { signal })
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<T>
}

export async function fetchTabs(apiRoot: string, signal?: AbortSignal): Promise<GalleryTab[]> {
  const response = await request<{ items: GalleryTab[] }>(apiRoot, "/tabs", signal)
  return response.items
}

export async function fetchImages(
  imageQuery: ImageQuery,
  apiRoot: string,
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
  return request<ImageListResponse>(apiRoot, `/images?${parameters}`, signal)
}

export async function fetchDimensions(
  tab: string,
  query: string,
  apiRoot: string,
  signal?: AbortSignal,
): Promise<DimensionFacet[]> {
  const parameters = new URLSearchParams({ tab, query })
  const response = await request<{ items: DimensionFacet[] }>(
    apiRoot,
    `/dimensions?${parameters}`,
    signal,
  )
  return response.items
}

export async function fetchTagSuggestions(
  tab: string,
  query: string,
  apiRoot: string,
  signal?: AbortSignal,
): Promise<TagSuggestion[]> {
  const parameters = new URLSearchParams({ tab, q: query })
  const response = await request<{ items: TagSuggestion[] }>(apiRoot, `/tags?${parameters}`, signal)
  return response.items
}

export function fetchImageDetails(
  imageId: string,
  apiRoot: string,
  signal?: AbortSignal,
): Promise<ImageDetails> {
  return request<ImageDetails>(apiRoot, `/images/${encodeURIComponent(imageId)}`, signal)
}

export async function sendToFavorites(
  imageId: string,
  apiRoot: string,
  filename?: string,
): Promise<{ filename: string; mode: string }> {
  const response = await fetch(`${apiRoot}/images/${encodeURIComponent(imageId)}/favorite`, {
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

export async function reindexTab(tab: string, apiRoot: string): Promise<void> {
  const response = await fetch(`${apiRoot}/reindex?${new URLSearchParams({ tab })}`, {
    method: "POST",
  })
  if (!response.ok) throw new Error(await response.text())
}

export async function revealImage(imageId: string, apiRoot: string): Promise<void> {
  const response = await fetch(`${apiRoot}/images/${encodeURIComponent(imageId)}/reveal`, {
    method: "POST",
  })
  if (!response.ok) throw new Error(await response.text())
}
