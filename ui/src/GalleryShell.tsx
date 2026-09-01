import "./GalleryShell.css"
import {
  DimensionFacet,
  FavoriteConflictError,
  fetchImageDetails,
  fetchDimensions,
  fetchImages,
  fetchTagSuggestions,
  fetchTabs,
  GalleryImage,
  GalleryTab,
  ImageDetails,
  ImageListResponse,
  reindexTab,
  revealImage,
  sendToFavorites,
  TagSuggestion,
} from "./galleryApi"
import { useDeferredValue, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

interface GalleryShellProps {
  openEvent: string
}

interface StoredCustomTab {
  id: string
  name: string
  folder: string
}

const COMFY_API_ROOT = "/api/image-shelf/v1"
const STANDALONE_API_ROOT = "http://127.0.0.1:8189/api/image-shelf/v1"
const PAGE_SIZE = 36
const CUSTOM_TABS_SETTING = "image-shelf.custom-tabs"
const FAVORITES_SETTING = "image-shelf.favorites-folder"

export function GalleryShell({ openEvent }: GalleryShellProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [tabs, setTabs] = useState<GalleryTab[]>([])
  const [selectedTabId, setSelectedTabId] = useState("outputs")
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const [images, setImages] = useState<GalleryImage[]>([])
  const [dimensions, setDimensions] = useState<DimensionFacet[]>([])
  const [selectedDimensions, setSelectedDimensions] = useState<string[]>([])
  const [sort, setSort] = useState<"created_at" | "filename">("created_at")
  const [direction, setDirection] = useState<"asc" | "desc">("desc")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [selectedImage, setSelectedImage] = useState<GalleryImage | null>(null)
  const [imageDetails, setImageDetails] = useState<ImageDetails | null>(null)
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle")
  const [useStandaloneBackend, setUseStandaloneBackend] = useState(false)
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([])
  const [groupByDay, setGroupByDay] = useState(true)

  useEffect(() => {
    const open = () => {
      console.log("ComfyUI.ImageShelf: open event received")
      setIsOpen(true)
    }
    window.addEventListener(openEvent, open)
    return () => window.removeEventListener(openEvent, open)
  }, [openEvent])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [])

  useEffect(() => {
    const updateDebugMode = (event: Event) => {
      setUseStandaloneBackend((event as CustomEvent<boolean>).detail)
    }
    window.addEventListener("image-shelf:debug-changed", updateDebugMode)
    return () => window.removeEventListener("image-shelf:debug-changed", updateDebugMode)
  }, [])

  const apiRoot = useStandaloneBackend ? STANDALONE_API_ROOT : COMFY_API_ROOT

  useEffect(() => {
    if (!isOpen || !deferredQuery.trim()) {
      setTagSuggestions([])
      return
    }
    const controller = new AbortController()
    const terms = deferredQuery.trim().split(/\s+/)
    const term = terms[terms.length - 1] ?? ""
    const prefix = term.replace(/^-?tag:/, "").replace(/^-/, "")
    void fetchTagSuggestions(selectedTabId, prefix, apiRoot, controller.signal)
      .then(setTagSuggestions)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setTagSuggestions([])
        }
      })
    return () => controller.abort()
  }, [apiRoot, deferredQuery, isOpen, selectedTabId])

  useEffect(() => {
    if (!isOpen) return
    const controller = new AbortController()
    void fetchTabs(apiRoot, controller.signal)
      .then((nextTabs) => {
        setTabs(nextTabs)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setStatus("error")
      })
    return () => controller.abort()
  }, [apiRoot, isOpen])

  useEffect(() => {
    if (!isOpen) return
    const controller = new AbortController()
    setStatus("loading")
    void Promise.all([
      fetchImages(
        {
          tab: selectedTabId,
          query: deferredQuery,
          dimensions: selectedDimensions,
          sort,
          direction,
          page,
          pageSize: PAGE_SIZE,
        },
        apiRoot,
        controller.signal,
      ),
      fetchDimensions(selectedTabId, deferredQuery, apiRoot, controller.signal),
    ])
      .then(([imagePage, nextDimensions]: [ImageListResponse, DimensionFacet[]]) => {
        setImages(imagePage.items)
        setTotal(imagePage.total)
        setDimensions(nextDimensions)
        setStatus("idle")
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setStatus("error")
      })
    return () => controller.abort()
  }, [apiRoot, deferredQuery, direction, isOpen, page, selectedDimensions, selectedTabId, sort])

  const updateTab = (tabId: string) => {
    setSelectedTabId(tabId)
    setSelectedDimensions([])
    setPage(1)
  }

  const toggleDimension = (dimension: string) => {
    setSelectedDimensions((current) =>
      current.includes(dimension)
        ? current.filter((value) => value !== dimension)
        : [...current, dimension],
    )
    setPage(1)
  }

  const updateSort = (value: string) => {
    const [nextSort, nextDirection] = value.split(":") as [
      "created_at" | "filename",
      "asc" | "desc",
    ]
    setSort(nextSort)
    setDirection(nextDirection)
    setPage(1)
  }

  const readCustomTabs = (): StoredCustomTab[] => {
    const value = window.app?.extensionManager.setting.get(CUSTOM_TABS_SETTING)
    if (typeof value !== "string") return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  const saveCustomTabs = async (nextTabs: StoredCustomTab[]) => {
    await window.app?.extensionManager.setting.set(CUSTOM_TABS_SETTING, JSON.stringify(nextTabs))
  }

  const addCustomTab = async () => {
    const name = await window.app?.extensionManager.dialog.prompt({
      title: t("gallery.addTab"),
      message: t("gallery.tabName"),
      defaultValue: t("gallery.newTab"),
    })
    if (!name?.trim()) return
    const folder = await window.app?.extensionManager.dialog.prompt({
      title: t("gallery.addTab"),
      message: t("gallery.folderPath"),
      defaultValue: "",
    })
    if (!folder?.trim()) return
    await saveCustomTabs([
      ...readCustomTabs(),
      { id: `custom-${crypto.randomUUID()}`, name: name.trim(), folder: folder.trim() },
    ])
  }

  const renameCustomTab = async (tab: GalleryTab) => {
    const name = await window.app?.extensionManager.dialog.prompt({
      title: t("gallery.renameTab"),
      message: t("gallery.tabName"),
      defaultValue: tab.name,
    })
    if (!name?.trim()) return
    await saveCustomTabs(
      readCustomTabs().map((storedTab) =>
        storedTab.id === tab.id ? { ...storedTab, name: name.trim() } : storedTab,
      ),
    )
  }

  const changeTabFolder = async (tab: GalleryTab) => {
    const storedTab = readCustomTabs().find((candidate) => candidate.id === tab.id)
    const folder = await window.app?.extensionManager.dialog.prompt({
      title: t("gallery.changeFolder"),
      message: t("gallery.folderPath"),
      defaultValue: storedTab?.folder ?? "",
    })
    if (!folder?.trim()) return
    await saveCustomTabs(
      readCustomTabs().map((candidate) =>
        candidate.id === tab.id ? { ...candidate, folder: folder.trim() } : candidate,
      ),
    )
  }

  const removeCustomTab = async (tab: GalleryTab) => {
    const confirmed = await window.app?.extensionManager.dialog.confirm({
      title: t("gallery.removeTab"),
      message: t("gallery.removeTabMessage", { name: tab.name }),
      type: "default",
    })
    if (!confirmed) return
    await saveCustomTabs(readCustomTabs().filter((storedTab) => storedTab.id !== tab.id))
    setSelectedTabId("outputs")
  }

  const configureFavoritesFolder = async () => {
    const currentValue = window.app?.extensionManager.setting.get(FAVORITES_SETTING)
    const folder = await window.app?.extensionManager.dialog.prompt({
      title: t("gallery.changeFolder"),
      message: t("gallery.folderPath"),
      defaultValue: typeof currentValue === "string" ? currentValue : "",
    })
    if (folder === undefined || folder === null) return
    await window.app?.extensionManager.setting.set(FAVORITES_SETTING, folder.trim())
  }

  const reindexSelectedTab = async () => {
    if (!selectedTab) return
    try {
      await reindexTab(selectedTab.id, apiRoot)
      setTabs((current) =>
        current.map((tab) => (tab.id === selectedTab.id ? { ...tab, indexing: true } : tab)),
      )
    } catch (error: unknown) {
      window.app?.extensionManager.toast.add({
        severity: "error",
        summary: t("gallery.reindexFailed"),
        detail: error instanceof Error ? error.message : String(error),
        life: 5000,
      })
    }
  }

  const revealSelectedImage = async () => {
    if (!selectedImage) return
    try {
      await revealImage(selectedImage.id, apiRoot)
    } catch (error: unknown) {
      window.app?.extensionManager.toast.add({
        severity: "error",
        summary: t("gallery.revealFailed"),
        detail: error instanceof Error ? error.message : String(error),
        life: 5000,
      })
    }
  }

  const selectTagSuggestion = (suggestion: TagSuggestion) => {
    const terms = query.trim().split(/\s+/)
    const activeTerm = terms[terms.length - 1] ?? ""
    const prefix = activeTerm.startsWith("-tag:")
      ? "-tag:"
      : activeTerm.startsWith("tag:-") || suggestion.type === "negative"
        ? "tag:-"
        : "tag:"
    terms[terms.length - 1] = `${prefix}"${suggestion.name}"`
    setQuery(terms.join(" ").trim())
    setTagSuggestions([])
  }

  const sendSelectedImageToFavorites = async (filename?: string) => {
    if (!selectedImage) return
    try {
      const result = await sendToFavorites(selectedImage.id, apiRoot, filename)
      window.app?.extensionManager.toast.add({
        severity: "success",
        summary: t("gallery.favoriteSent"),
        detail: result.filename,
        life: 3000,
      })
    } catch (error: unknown) {
      if (error instanceof FavoriteConflictError) {
        const replacement = await window.app?.extensionManager.dialog.prompt({
          title: t("gallery.favoriteConflict"),
          message: t("gallery.favoriteConflictMessage"),
          defaultValue: error.suggestedFilename,
        })
        if (replacement) await sendSelectedImageToFavorites(replacement)
        return
      }
      window.app?.extensionManager.toast.add({
        severity: "error",
        summary: t("gallery.favoriteFailed"),
        detail: error instanceof Error ? error.message : String(error),
        life: 5000,
      })
    }
  }

  const selectedTab = tabs.find((tab) => tab.id === selectedTabId)
  const selectedImageIndex = selectedImage
    ? images.findIndex((image) => image.id === selectedImage.id)
    : -1
  const imageGroups: [string, GalleryImage[]][] = groupByDay
    ? (Object.entries(
        images.reduce<Record<string, GalleryImage[]>>((groups, image) => {
          const day = new Date(image.created_at * 1000).toLocaleDateString()
          groups[day] = [...(groups[day] ?? []), image]
          return groups
        }, {}),
      ) as [string, GalleryImage[]][])
    : [[t("gallery.allImages"), images]]

  useEffect(() => {
    if (!selectedImage) {
      setImageDetails(null)
      return
    }
    const controller = new AbortController()
    void fetchImageDetails(selectedImage.id, apiRoot, controller.signal)
      .then(setImageDetails)
      .catch(() => setImageDetails(null))
    return () => controller.abort()
  }, [apiRoot, selectedImage])

  useEffect(() => {
    if (!selectedImage) return
    const navigate = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedImage(null)
      if (event.key === "ArrowLeft" && selectedImageIndex > 0) {
        setSelectedImage(images[selectedImageIndex - 1])
      }
      if (event.key === "ArrowRight" && selectedImageIndex < images.length - 1) {
        setSelectedImage(images[selectedImageIndex + 1])
      }
    }
    window.addEventListener("keydown", navigate)
    return () => window.removeEventListener("keydown", navigate)
  }, [images, selectedImage, selectedImageIndex])

  if (!isOpen) return null

  return (
    <div className="image-shelf-backdrop" role="presentation" onMouseDown={() => setIsOpen(false)}>
      <section
        aria-label={t("gallery.title")}
        aria-modal="true"
        className="image-shelf-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="image-shelf-header">
          <div>
            <p className="image-shelf-eyebrow">ComfyUI</p>
            <h1>{t("gallery.title")}</h1>
          </div>
          <button
            aria-label={t("gallery.close")}
            className="image-shelf-icon-button"
            onClick={() => setIsOpen(false)}
            type="button"
          >
            x
          </button>
        </header>
        <div className="image-shelf-toolbar">
          <div className="image-shelf-search">
            <input
              aria-autocomplete="list"
              aria-controls="image-shelf-tag-suggestions"
              aria-expanded={tagSuggestions.length > 0}
              aria-label={t("gallery.search")}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("gallery.search")}
              type="search"
              value={query}
            />
            {tagSuggestions.length > 0 && (
              <div
                className="image-shelf-suggestions"
                id="image-shelf-tag-suggestions"
                role="listbox"
              >
                {tagSuggestions.map((suggestion) => (
                  <button
                    key={`${suggestion.type}-${suggestion.name}`}
                    onClick={() => selectTagSuggestion(suggestion)}
                    role="option"
                    type="button"
                  >
                    {suggestion.type === "negative" ? "- " : ""}
                    {suggestion.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <select
            aria-label={t("gallery.sort")}
            onChange={(event) => updateSort(event.target.value)}
            value={`${sort}:${direction}`}
          >
            <option value="created_at:desc">{t("gallery.newest")}</option>
            <option value="created_at:asc">{t("gallery.oldest")}</option>
            <option value="filename:asc">{t("gallery.filenameAscending")}</option>
            <option value="filename:desc">{t("gallery.filenameDescending")}</option>
          </select>
        </div>
        <details className="image-shelf-search-help">
          <summary>{t("gallery.searchHelp")}</summary>
          <p>{t("gallery.searchSyntax")}</p>
        </details>
        {dimensions.length > 0 && (
          <div aria-label={t("gallery.filters")} className="image-shelf-facets">
            {dimensions.map((dimension) => {
              const value = `${dimension.width}x${dimension.height}`
              return (
                <label key={value}>
                  <input
                    checked={selectedDimensions.includes(value)}
                    onChange={() => toggleDimension(value)}
                    type="checkbox"
                  />
                  {value} ({dimension.count})
                </label>
              )
            })}
          </div>
        )}
        <div className="image-shelf-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              aria-selected={selectedTabId === tab.id}
              key={tab.id}
              onClick={() => updateTab(tab.id)}
              role="tab"
              type="button"
            >
              {tab.name} {tab.indexing ? "..." : `(${tab.count})`}
            </button>
          ))}
          <button
            aria-label={t("gallery.addTab")}
            className="image-shelf-add-tab"
            onClick={() => void addCustomTab()}
            type="button"
          >
            +
          </button>
        </div>
        {selectedTab && (selectedTab.editable || selectedTab.removable) && (
          <div className="image-shelf-tab-actions">
            {selectedTab.id === "favorites" ? (
              <button onClick={() => void configureFavoritesFolder()} type="button">
                {t("gallery.changeFolder")}
              </button>
            ) : (
              <>
                <button onClick={() => void renameCustomTab(selectedTab)} type="button">
                  {t("gallery.renameTab")}
                </button>
                <button onClick={() => void changeTabFolder(selectedTab)} type="button">
                  {t("gallery.changeFolder")}
                </button>
              </>
            )}
            {selectedTab.removable && (
              <button onClick={() => void removeCustomTab(selectedTab)} type="button">
                {t("gallery.removeTab")}
              </button>
            )}
            {selectedTab.configured && (
              <button onClick={() => void reindexSelectedTab()} type="button">
                {t("gallery.reindex")}
              </button>
            )}
          </div>
        )}
        <label className="image-shelf-group-toggle">
          <input
            checked={groupByDay}
            onChange={(event) => setGroupByDay(event.target.checked)}
            type="checkbox"
          />
          {t("gallery.groupByDay")}
        </label>
        <main className="image-shelf-empty-state">
          {status === "loading" && <p>{t("gallery.loading")}</p>}
          {status === "error" && <p>{t("gallery.error")}</p>}
          {status === "idle" && selectedTab && !selectedTab.configured && (
            <p>{t("gallery.favoritesUnconfigured")}</p>
          )}
          {status === "idle" && selectedTab?.configured && images.length === 0 && (
            <p>{t("gallery.empty")}</p>
          )}
          {status === "idle" && images.length > 0 && (
            <>
              <div className="image-shelf-grid-groups">
                {imageGroups.map(([day, group]) => (
                  <section className="image-shelf-image-group" key={day}>
                    {groupByDay && <h2>{day}</h2>}
                    <div className="image-shelf-grid">
                      {group.map((image) => (
                        <button
                          className="image-shelf-tile"
                          key={image.id}
                          onClick={() => setSelectedImage(image)}
                          type="button"
                        >
                          <img alt={image.filename} loading="lazy" src={image.url} />
                          <span className="image-shelf-tile-name">
                            {image.filename}
                            {image.parse_error && (
                              <span
                                aria-label={t("gallery.metadataWarning")}
                                className="image-shelf-metadata-warning"
                                title={image.parse_error}
                              >
                                !
                              </span>
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <nav aria-label={t("gallery.pagination")} className="image-shelf-pagination">
                <button disabled={page === 1} onClick={() => setPage(page - 1)} type="button">
                  {t("gallery.previous")}
                </button>
                <span>{t("gallery.page", { page, total: Math.ceil(total / PAGE_SIZE) })}</span>
                <button
                  disabled={page * PAGE_SIZE >= total}
                  onClick={() => setPage(page + 1)}
                  type="button"
                >
                  {t("gallery.next")}
                </button>
              </nav>
            </>
          )}
        </main>
        {selectedImage && (
          <div
            className="image-shelf-viewer"
            role="presentation"
            onMouseDown={() => setSelectedImage(null)}
          >
            <section
              aria-label={selectedImage.filename}
              aria-modal="true"
              className="image-shelf-viewer-dialog"
              onMouseDown={(event) => event.stopPropagation()}
              role="dialog"
            >
              <img alt={selectedImage.filename} src={selectedImage.url} />
              <aside>
                <button onClick={() => setSelectedImage(null)} type="button">
                  {t("gallery.close")}
                </button>
                <button onClick={() => void revealSelectedImage()} type="button">
                  {t("gallery.reveal")}
                </button>
                <button onClick={() => void sendSelectedImageToFavorites()} type="button">
                  {t("gallery.sendToFavorites")}
                </button>
                <h2>{selectedImage.filename}</h2>
                {imageDetails ? (
                  <>
                    <dl className="image-shelf-metadata">
                      <dt>{t("gallery.dimensions")}</dt>
                      <dd>
                        {imageDetails.width} x {imageDetails.height}
                      </dd>
                      <dt>{t("gallery.creationDate")}</dt>
                      <dd>{new Date(imageDetails.created_at * 1000).toLocaleString()}</dd>
                      <dt>{t("gallery.fileSize")}</dt>
                      <dd>{Math.ceil(imageDetails.file_size / 1024)} KB</dd>
                      {imageDetails.tags.length > 0 && (
                        <>
                          <dt>{t("gallery.tags")}</dt>
                          <dd>{imageDetails.tags.join(", ")}</dd>
                        </>
                      )}
                      {imageDetails.negative_tags.length > 0 && (
                        <>
                          <dt>{t("gallery.negativeTags")}</dt>
                          <dd>{imageDetails.negative_tags.join(", ")}</dd>
                        </>
                      )}
                      {imageDetails.parse_error && (
                        <>
                          <dt>{t("gallery.metadataWarning")}</dt>
                          <dd>{imageDetails.parse_error}</dd>
                        </>
                      )}
                    </dl>
                  </>
                ) : (
                  <p>{t("gallery.loading")}</p>
                )}
              </aside>
            </section>
          </div>
        )}
      </section>
    </div>
  )
}
