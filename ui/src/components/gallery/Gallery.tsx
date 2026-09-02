import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderCogIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwClockIcon,
  Settings2Icon,
  SettingsIcon,
  StarIcon,
  TrashIcon,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { app } from "../../comfy"
import {
  DimensionFacet,
  FavoriteConflictError,
  fetchDimensions,
  fetchImageDetails,
  fetchImages,
  fetchTabs,
  GalleryImage,
  GalleryTab,
  ImageDetails,
  ImageListResponse,
  reindexTab as reindexTabApi,
  revealImage,
  sendToFavorites,
} from "../../galleryApi"
import {
  COMFY_API_ROOT,
  CUSTOM_TABS_SETTING,
  FAVORITES_SETTING,
  STANDALONE_API_ROOT,
} from "../../global"
import { useTranslation } from "../../i18n/i18n"
import { cn } from "../../lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"
import { Field } from "../ui/field"
import { Input } from "../ui/input"
import { Label } from "../ui/label"
import { Searchbar } from "./Searchbar"

interface GalleryProps {
  openEvent: string
}

interface StoredCustomTab {
  id: string
  name: string
  folder: string
}

const PAGE_SIZE = 36

export function Gallery({ openEvent }: GalleryProps) {
  const t = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [tabs, setTabs] = useState<GalleryTab[]>([])
  const [selectedTabId, setSelectedTabId] = useState("outputs")
  const [query, setQuery] = useState("")
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
  const [groupByDay, setGroupByDay] = useState(true)
  const searchAbortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const open = () => setIsOpen(true)
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

  const search = () => {
    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort()
    }
    setStatus("loading")
    const controller = new AbortController()
    searchAbortControllerRef.current = controller
    void Promise.all([
      fetchImages(
        {
          tab: selectedTabId,
          query,
          dimensions: selectedDimensions,
          sort,
          direction,
          page,
          pageSize: PAGE_SIZE,
        },
        apiRoot,
        controller.signal,
      ),
      fetchDimensions(selectedTabId, query, apiRoot, controller.signal),
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
  }

  useEffect(() => {
    search()
  }, [])

  const selectTab = (tabId: string) => {
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
    const value = app.extensionManager.setting.get(CUSTOM_TABS_SETTING)
    if (typeof value !== "string") return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  const saveCustomTabs = async (nextTabs: StoredCustomTab[]) => {
    await app.extensionManager.setting.set(CUSTOM_TABS_SETTING, JSON.stringify(nextTabs))
  }

  const addCustomTab = async () => {
    const name = await app.extensionManager.dialog.prompt({
      title: t.gallery.addTab,
      message: t.gallery.tabName,
      defaultValue: t.gallery.newTab,
    })
    if (!name?.trim()) return
    const folder = await app.extensionManager.dialog.prompt({
      title: t.gallery.addTab,
      message: t.gallery.folderPath,
      defaultValue: "",
    })
    if (!folder?.trim()) return
    await saveCustomTabs([
      ...readCustomTabs(),
      { id: `custom-${crypto.randomUUID()}`, name: name.trim(), folder: folder.trim() },
    ])
  }

  const renameCustomTab = async (tab: GalleryTab) => {
    const name = await app.extensionManager.dialog.prompt({
      title: t.gallery.renameTab,
      message: t.gallery.tabName,
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
    if (tab.id === "favorites") {
      await configureFavoritesFolder()
      return
    }
    const storedTab = readCustomTabs().find((candidate) => candidate.id === tab.id)
    const folder = await app.extensionManager.dialog.prompt({
      title: t.gallery.changeFolder,
      message: t.gallery.folderPath,
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
    const confirmed = await app.extensionManager.dialog.confirm({
      title: t.gallery.removeTab,
      message: t.gallery.removeTabMessage({ name: tab.name }),
      type: "default",
    })
    if (!confirmed) return
    await saveCustomTabs(readCustomTabs().filter((storedTab) => storedTab.id !== tab.id))
    setSelectedTabId("outputs")
  }

  const configureFavoritesFolder = async () => {
    const currentValue = app.extensionManager.setting.get(FAVORITES_SETTING)
    const folder = await app.extensionManager.dialog.prompt({
      title: t.gallery.changeFolder,
      message: t.gallery.folderPath,
      defaultValue: typeof currentValue === "string" ? currentValue : "",
    })
    if (folder === undefined || folder === null) return
    await app.extensionManager.setting.set(FAVORITES_SETTING, folder.trim())
  }

  const reindexTab = async (tab: GalleryTab) => {
    try {
      await reindexTabApi(tab.id, apiRoot)
      setTabs((current) => current.map((t) => (t.id === tab.id ? { ...t, indexing: true } : t)))
    } catch (error: unknown) {
      app.extensionManager.toast.add({
        severity: "error",
        summary: t.gallery.reindexFailed,
        detail: error instanceof Error ? error.message : String(error),
        life: 5000,
      })
    }
  }

  const reindexSelectedTab = async () => {
    if (!selectedTab) return
    await reindexTab(selectedTab)
  }

  const revealSelectedImage = async () => {
    if (!selectedImage) return
    try {
      await revealImage(selectedImage.id, apiRoot)
    } catch (error: unknown) {
      app.extensionManager.toast.add({
        severity: "error",
        summary: t.gallery.revealFailed,
        detail: error instanceof Error ? error.message : String(error),
        life: 5000,
      })
    }
  }

  const sendSelectedImageToFavorites = async (filename?: string) => {
    if (!selectedImage) return
    try {
      const result = await sendToFavorites(selectedImage.id, apiRoot, filename)
      app.extensionManager.toast.add({
        severity: "success",
        summary: t.gallery.favoriteSent,
        detail: result.filename,
        life: 3000,
      })
    } catch (error: unknown) {
      if (error instanceof FavoriteConflictError) {
        const replacement = await app.extensionManager.dialog.prompt({
          title: t.gallery.favoriteConflict,
          message: t.gallery.favoriteConflictMessage,
          defaultValue: error.suggestedFilename,
        })
        if (replacement) await sendSelectedImageToFavorites(replacement)
        return
      }
      app.extensionManager.toast.add({
        severity: "error",
        summary: t.gallery.favoriteFailed,
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
    : [[t.gallery.allImages, images]]

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
    <Dialog onOpenChange={setIsOpen} open={isOpen}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[min(900px,calc(100vh-2rem))] w-[calc(100%-2rem)] sm:max-w-375 gap-0 overflow-hidden rounded-xl border-border p-0 shadow-2xl"
      >
        <aside className="w-80 shrink-0 flex flex-col overflow-y-auto border-r">
          <DialogHeader className="flex-row items-center gap-3 border-b p-4">
            <ImageIcon className="size-8" />
            <DialogTitle className="text-xl">{t.gallery.title}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1 p-4 border-t">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={cn("flex rounded-md", tab === selectedTab && "bg-(--chart-3)")}
              >
                <Button
                  variant="ghost"
                  className={cn(
                    "grow justify-start",
                    tab === selectedTab && "hover:bg-(--chart-4) dark:hover:bg-(--chart-4)",
                  )}
                  onClick={() => selectTab(tab.id)}
                >
                  {tab.id === "outputs" ? (
                    <RotateCcwClockIcon data-icon="inline-start" />
                  ) : tab.id === "favorites" ? (
                    <StarIcon data-icon="inline-start" />
                  ) : (
                    <FolderIcon data-icon="inline-start" />
                  )}
                  {tab.name} {tab.indexing ? "..." : `(${tab.count})`}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className={cn(
                        tab === selectedTab && "hover:bg-(--chart-4) dark:hover:bg-(--chart-4)",
                      )}
                    >
                      <SettingsIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onSelect={() => void reindexTab(tab)}>
                        <RefreshCwIcon />
                        {t.gallery.reindex}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!tab.editable}
                        onSelect={() => changeTabFolder(tab)}
                      >
                        <FolderCogIcon />
                        {t.gallery.changeFolder}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!tab.editable || tab.id === "favorites"}
                        onSelect={() => void renameCustomTab(tab)}
                      >
                        <Settings2Icon />
                        {t.gallery.renameTab}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={!tab.removable}
                        onSelect={() => void removeCustomTab(tab)}
                      >
                        <TrashIcon />
                        {t.gallery.removeTab}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
            <Button
              className="grow justify-start"
              onClick={() => void addCustomTab()}
              variant="ghost"
            >
              <PlusIcon data-icon="inline-start" />
              {t.gallery.addTab}
            </Button>
          </div>
          <div className="flex flex-col gap-4 p-4 border-t">
            <h3 className="text-sm font-semibold">{t.gallery.sort}</h3>
            <Select onValueChange={updateSort} value={`${sort}:${direction}`}>
              <SelectTrigger aria-label={t.gallery.sort} className="max-w-full sm:w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="created_at:desc">{t.gallery.newest}</SelectItem>
                  <SelectItem value="created_at:asc">{t.gallery.oldest}</SelectItem>
                  <SelectItem value="filename:asc">{t.gallery.filenameAscending}</SelectItem>
                  <SelectItem value="filename:desc">{t.gallery.filenameDescending}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Field orientation="horizontal">
              <Checkbox
                checked={groupByDay}
                id="group-by-day"
                onCheckedChange={(checked) => setGroupByDay(checked === true)}
              />
              <Label className="cursor-pointer" htmlFor="group-by-day">
                {t.gallery.groupByDay}
              </Label>
            </Field>
          </div>
          {dimensions.length > 0 && (
            <div className="flex flex-col gap-4 p-4 border-t">
              <h3 className="text-sm font-semibold">{t.gallery.dimensions}</h3>
              <div className="flex flex-col gap-2">
                {dimensions.map((dimension) => {
                  const value = `${dimension.width}x${dimension.height}`
                  return (
                    <Field orientation="horizontal" key={value}>
                      <Checkbox
                        checked={selectedDimensions.includes(value)}
                        id={`dimension-${value}`}
                        onCheckedChange={() => toggleDimension(value)}
                      />
                      <Label className="cursor-pointer" htmlFor={`dimension-${value}`}>
                        {value} ({dimension.count})
                      </Label>
                    </Field>
                  )
                })}
              </div>
            </div>
          )}
        </aside>

        <main className="flex grow flex-col">
          <div className="flex items-center gap-4 p-4 pr-16">
            <Searchbar
              apiRoot={apiRoot}
              tab={selectedTab}
              value={query}
              onChange={setQuery}
              onSubmit={search}
            />
          </div>
          {status === "loading" && <p>{t.gallery.loading}</p>}
          {status === "error" && (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground">
              <p>{t.gallery.error}</p>
            </div>
          )}
          {status === "idle" && selectedTab && !selectedTab.configured && (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground">
              <p>{t.gallery.favoritesUnconfigured}</p>
            </div>
          )}
          {status === "idle" && selectedTab?.configured && images.length === 0 && (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground">
              <p>{t.gallery.empty}</p>
            </div>
          )}
          {status === "idle" && selectedTab?.configured && images.length > 0 && (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {imageGroups.map(([day, group]) => (
                  <section className="border-b px-5 py-4 last:border-b-0" key={day}>
                    {groupByDay && (
                      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{day}</h2>
                    )}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                      {group.map((image) => (
                        <Button
                          className="group h-auto min-w-0 flex-col items-stretch gap-2 overflow-hidden border bg-card p-2 text-left font-normal shadow-xs hover:bg-accent"
                          key={image.id}
                          onClick={() => setSelectedImage(image)}
                          type="button"
                          variant="outline"
                        >
                          <img
                            alt={image.filename}
                            className="aspect-square w-full rounded-sm object-cover"
                            loading="lazy"
                            src={image.url}
                          />
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate">{image.filename}</span>
                            {image.parse_error && (
                              <Badge
                                aria-label={t.gallery.metadataWarning}
                                className="ml-auto shrink-0 px-1.5"
                                title={image.parse_error}
                                variant="destructive"
                              >
                                !
                              </Badge>
                            )}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <nav
                aria-label={t.gallery.pagination}
                className="flex items-center justify-end gap-3 border-t px-5 py-3"
              >
                <Button
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                  size="sm"
                  variant="outline"
                >
                  <ChevronLeftIcon data-icon="inline-start" />
                  {t.gallery.previous}
                </Button>
                <Input
                  className="w-12 text-center"
                  type="number"
                  value={page}
                  onBlur={(e) => {
                    const value = parseInt(e.target.value, 10)
                    if (!isNaN(value) && value >= 1 && value <= Math.ceil(total / PAGE_SIZE)) {
                      setPage(value)
                    } else {
                      e.target.value = String(page)
                    }
                  }}
                />
                <span>/{Math.ceil(total / PAGE_SIZE)}</span>
                <Button
                  disabled={page * PAGE_SIZE >= total}
                  onClick={() => setPage(page + 1)}
                  size="sm"
                  variant="outline"
                >
                  {t.gallery.next}
                  <ChevronRightIcon data-icon="inline-end" />
                </Button>
              </nav>
            </>
          )}
        </main>

        {selectedImage && (
          <Dialog
            onOpenChange={(open) => !open && setSelectedImage(null)}
            open={Boolean(selectedImage)}
          >
            <DialogContent
              aria-describedby={undefined}
              className="max-w-screen! w-screen h-screen flex gap-0 overflow-hidden p-0 bg-transparent"
            >
              <aside className="w-80 overflow-y-auto border-r bg-card">
                <DialogHeader className="p-4 border-b">
                  <DialogTitle>{selectedImage.filename}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-wrap gap-2 p-4 border-b">
                  <Button onClick={() => void sendSelectedImageToFavorites()} size="sm">
                    <StarIcon data-icon="inline-start" />
                    {t.gallery.sendToFavorites}
                  </Button>
                  <Button onClick={() => void revealSelectedImage()} size="sm" variant="outline">
                    <FolderOpenIcon data-icon="inline-start" />
                    {t.gallery.reveal}
                  </Button>
                </div>
                {imageDetails ? (
                  <dl className="mt-4 p-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
                    <dt className="text-muted-foreground">{t.gallery.dimensions}</dt>
                    <dd className="break-words">
                      {imageDetails.width} x {imageDetails.height}
                    </dd>
                    <dt className="text-muted-foreground">{t.gallery.creationDate}</dt>
                    <dd className="break-words">
                      {new Date(imageDetails.created_at * 1000).toLocaleString()}
                    </dd>
                    <dt className="text-muted-foreground">{t.gallery.fileSize}</dt>
                    <dd className="break-words">{Math.ceil(imageDetails.file_size / 1024)} KB</dd>
                    {imageDetails.tags.length > 0 && (
                      <>
                        <dt className="text-muted-foreground">{t.gallery.tags}</dt>
                        <dd className="break-words">{imageDetails.tags.join(", ")}</dd>
                      </>
                    )}
                    {imageDetails.negative_tags.length > 0 && (
                      <>
                        <dt className="text-muted-foreground">{t.gallery.negativeTags}</dt>
                        <dd className="break-words">{imageDetails.negative_tags.join(", ")}</dd>
                      </>
                    )}
                    {imageDetails.parse_error && (
                      <>
                        <dt className="text-muted-foreground">{t.gallery.metadataWarning}</dt>
                        <dd className="break-words">{imageDetails.parse_error}</dd>
                      </>
                    )}
                  </dl>
                ) : (
                  <p className="mt-5 text-sm text-muted-foreground">{t.gallery.loading}</p>
                )}
              </aside>
              <main className="grow flex flex-col" onClick={() => setSelectedImage(null)}>
                <img
                  alt={selectedImage.filename}
                  className="size-full object-contain"
                  src={selectedImage.url}
                />
              </main>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  )
}
