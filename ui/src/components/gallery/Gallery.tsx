import { cn } from "cn"
import { useAtom } from "jotai"
import { clamp } from "lodash-es"
import {
  AlertCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyPlusIcon,
  EllipsisVerticalIcon,
  FileInputIcon,
  FolderIcon,
  ImageIcon,
  SettingsIcon,
  SquareCheckBigIcon,
  SquareIcon,
} from "lucide-react"
import { ReactNode, useEffect, useState } from "react"
import { useDebounce } from "react-use"

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

import { useTranslation } from "../../i18n/i18n"
import { galleryConfigAtom } from "../../lib/config"
import { formatError } from "../../lib/error"
import { queryToString, SearchQuery, SearchTerm } from "../../lib/search"
import { GalleryFolder, GalleryImage } from "../../services/gallery"
import { EMPTY_ARRAY } from "../../utils/lang"
import { PopoverControl, usePopoverControl, usePopoverTrigger } from "../../utils/react"
import { SettingsDialog } from "../settings"
import { Alert, AlertDescription, AlertTitle } from "../ui/alert"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"
import { Field, FieldLabel } from "../ui/field"
import { Input } from "../ui/input"
import { Label } from "../ui/label"
import { ScrollArea } from "../ui/scroll-area"
import { useFolderList, useImageQuery } from "./api"
import { FolderList } from "./folder"
import { transferSelectedImages } from "./helpers"
import { ImageViewer } from "./ImageViewer"
import { parseSearchValue, Searchbar } from "./Searchbar"

interface GalleryControlProps {
  openEvent: string
}

interface GalleryProps {
  isOpen?: boolean
  onOpenChange?: (isOpen: boolean) => void
}

export function GalleryControl({ openEvent }: GalleryControlProps) {
  const { isOpen, shouldRender, setOpenState } = usePopoverControl()

  useEffect(() => {
    const open = () => setOpenState(true)
    window.addEventListener(openEvent, open)
    return () => window.removeEventListener(openEvent, open)
  }, [openEvent, setOpenState])

  return shouldRender ? <Gallery isOpen={isOpen} onOpenChange={setOpenState} /> : null
}

export function Gallery({ isOpen, onOpenChange }: GalleryProps) {
  const t = useTranslation()
  const [config, setConfig] = useAtom(galleryConfigAtom)
  const [query, setQuery] = useState<SearchQuery>(() => parseSearchValue(config.query, -1))
  const [debouncedQuery, setDebouncedQuery] = useState<SearchQuery>(query)
  const [selectedDimensions, setSelectedDimensions] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [activeImageId, setActiveImageId] = useState<string | undefined>(undefined)
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([])
  const settingsTrigger = usePopoverTrigger()
  const imageViewerTrigger = usePopoverTrigger()

  const { data: folders, mutate: mutateFolders } = useFolderList()

  const {
    data: imageList,
    error: imageListError,
    isLoading: imageListIsLoading,
  } = useImageQuery({
    folder: config.activeFolder,
    query: debouncedQuery,
    dimensions: selectedDimensions,
    sort: config.sort,
    direction: config.direction,
    page,
    pageSize: config.pageSize,
  })
  const images = imageList?.items ?? EMPTY_ARRAY
  const imageListTotal = imageList?.total ?? 0
  const dimensions = imageList?.dimensions ?? EMPTY_ARRAY
  const activeImage = images.find((image) => image.id === activeImageId)
  const selectedImages = images.filter((image) => selectedImageIds.includes(image.id))

  useDebounce(
    () => {
      setDebouncedQuery(query)
      setConfig({ query: queryToString(query) })
    },
    500,
    [query],
  )

  const selectFolder = (folderId: string) => {
    setConfig({ activeFolder: folderId })
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
    setConfig({ sort: nextSort, direction: nextDirection })
    setPage(1)
  }

  const activeFolder = folders?.find((folder) => folder.id === config.activeFolder)
  const imageGroups: [string, GalleryImage[]][] = config.groupByDay
    ? (Object.entries(
        images.reduce<Record<string, GalleryImage[]>>((groups, image) => {
          const day = new Date(image.created_at * 1000).toLocaleDateString()
          groups[day] = [...(groups[day] ?? []), image]
          return groups
        }, {}),
      ) as [string, GalleryImage[]][])
    : [[t.gallery.allImages, images]]
  const activeImageIndexInCurrentPage = activeImageId
    ? images.findIndex((image) => image.id === activeImageId)
    : -1
  const activeImageIndexInAllPages =
    activeImageIndexInCurrentPage !== -1
      ? (page - 1) * config.pageSize + activeImageIndexInCurrentPage
      : -1

  const handleNavigate = (offset: number) => {
    const currentIndex = images.findIndex((image) => image.id === activeImageId)
    const nextIndex = clamp(currentIndex + offset, 0, images.length - 1)
    setActiveImageId(images[nextIndex]?.id)
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[calc(100vh-4rem)] h-250 w-375 gap-0 overflow-hidden rounded-xl bg-card p-0"
        closeButtonProps={{ size: "icon", className: "top-4 right-4" }}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <aside className="md:w-80 w-40 shrink-0 flex flex-col border-r">
          <ScrollArea className="min-h-0 flex-1">
            <DialogHeader className="flex-row items-center gap-3 border-b p-4">
              <ImageIcon className="size-8" />
              <DialogTitle className="text-xl">{t.gallery.title}</DialogTitle>
            </DialogHeader>
            <FolderList
              folders={folders}
              selectedFolderId={config.activeFolder}
              onFolderSelect={selectFolder}
              updateTabs={mutateFolders}
            />
            <div className="flex flex-col gap-4 p-4 border-t">
              <h3 className="text-sm font-semibold">{t.gallery.sort}</h3>
              <Select onValueChange={updateSort} value={`${config.sort}:${config.direction}`}>
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
                  checked={config.groupByDay}
                  id="group-by-day"
                  onCheckedChange={(checked) => setConfig({ groupByDay: checked === true })}
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
          </ScrollArea>
          <div className="border-t p-4 flex flex-col">
            <Button
              variant="flat"
              className="justify-start"
              onClick={() => settingsTrigger.toggle(true)}
            >
              <SettingsIcon data-icon="inline-start" />
              {t.settings.title}
            </Button>
          </div>
        </aside>

        <main className="grow flex flex-col">
          <div className="flex items-center px-4 pt-4 pb-2 pr-16">
            <Searchbar loading={imageListIsLoading} query={query} onQueryChange={setQuery} />
          </div>
          {imageListError && (
            <Alert variant="destructive" className="mx-4 w-fit self-start">
              <AlertCircleIcon />
              <AlertTitle>{t.gallery.error}</AlertTitle>
              <AlertDescription>{formatError(imageListError)}</AlertDescription>
            </Alert>
          )}
          {activeFolder?.error && (
            <Alert variant="destructive" className="mx-4 w-fit self-start">
              <AlertCircleIcon />
              <AlertTitle>{t.gallery.folderError({ name: activeFolder.name })}</AlertTitle>
              <AlertDescription>{formatError(activeFolder.error)}</AlertDescription>
            </Alert>
          )}
          {!images.length &&
            (imageListIsLoading ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                {t.gallery.loading}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                {t.gallery.empty}
              </div>
            ))}
          {images.length > 0 && (
            <ScrollArea className="min-h-0 flex-1">
              {imageGroups.map(([day, group]) => (
                <section className="border-b px-4 py-4 first:pt-2 last:border-b-0" key={day}>
                  {config.groupByDay && (
                    <h2 className="mb-2 px-2 text-sm font-semibold text-muted-foreground">{day}</h2>
                  )}
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {group.map((image) => (
                      <figure
                        key={image.id}
                        className={cn(
                          "relative group h-auto min-w-0 flex flex-col",
                          selectedImageIds.includes(image.id) && "ring-inset ring-2 ring-blue-500",
                        )}
                      >
                        <Button
                          className="h-full flex-col items-stretch gap-2 overflow-hidden border p-2 font-normal shadow-xs"
                          onClick={() => {
                            setActiveImageId(image.id)
                            imageViewerTrigger.toggle(true)
                          }}
                          type="button"
                          variant="flat"
                        >
                          <img
                            alt={image.filename}
                            className="aspect-square w-full rounded-sm object-cover"
                            loading="lazy"
                            src={image.thumbnail_url ?? image.url}
                          />
                          <h4 className="flex min-w-0 items-center gap-1.5">
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
                          </h4>
                        </Button>
                        <div
                          className={cn(
                            "absolute top-2 left-2 right-2 flex items-center group-hover:opacity-100 opacity-0 bg-linear-180 from-black/50 to-transparent transition-opacity",
                            selectedImageIds.includes(image.id) && "opacity-100",
                          )}
                        >
                          <Button
                            className="-ml-2 -mt-2 p-2"
                            variant="flat"
                            size={null}
                            onClick={() => {
                              if (selectedImageIds.includes(image.id)) {
                                setSelectedImageIds(
                                  selectedImageIds.filter((id) => id !== image.id),
                                )
                              } else {
                                setSelectedImageIds([...selectedImageIds, image.id])
                              }
                            }}
                          >
                            {selectedImageIds.includes(image.id) ? (
                              <SquareCheckBigIcon className="size-6" />
                            ) : (
                              <SquareIcon className="size-6" />
                            )}
                          </Button>
                          <Button className="-mr-3 -mt-2 ml-auto p-2" variant="flat" size={null}>
                            <EllipsisVerticalIcon className="size-6" />
                          </Button>
                        </div>
                      </figure>
                    ))}
                  </div>
                </section>
              ))}
            </ScrollArea>
          )}
          <footer className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
            {imageList && (
              <div className="text-muted-foreground text-xs">
                {t.gallery.searchTime({ elapsed: Math.round(imageList.elapsed * 1000) })}
              </div>
            )}
            {selectedImageIds.length > 0 ? (
              <>
                <div className="ml-auto text-muted-foreground">
                  {t.gallery.selectedImages({ count: selectedImageIds.length })}
                </div>
                <Button
                  className="min-w-18"
                  variant="outline"
                  onClick={() => setSelectedImageIds([])}
                >
                  {t.common.cancel}
                </Button>
                <Button
                  className="min-w-18"
                  variant="outline"
                  onClick={() => setSelectedImageIds(images.map((image) => image.id))}
                >
                  {t.gallery.selectAll}
                </Button>
                <TransferMenu
                  folders={folders}
                  currentFolderId={config.activeFolder}
                  images={selectedImages}
                  mode="copy"
                  label={t.gallery.copyTo}
                  icon={<CopyPlusIcon data-icon="inline-start" />}
                  onComplete={() => setSelectedImageIds([])}
                />
                <TransferMenu
                  folders={folders}
                  currentFolderId={config.activeFolder}
                  images={selectedImages}
                  mode="move"
                  label={t.gallery.moveTo}
                  icon={<FileInputIcon data-icon="inline-start" />}
                  onComplete={() => setSelectedImageIds([])}
                />
              </>
            ) : (
              <>
                <Field orientation="horizontal" className="w-fit ml-auto">
                  <FieldLabel htmlFor="select-rows-per-page">{t.gallery.pageSize}</FieldLabel>
                  <Select
                    value={`${config.pageSize}`}
                    onValueChange={(value) => setConfig({ pageSize: parseInt(value, 10) })}
                  >
                    <SelectTrigger className="w-20" id="select-rows-per-page">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectGroup>
                        {[18, 36, 60, 100, 150, 200, 300, 1000].map((size) => (
                          <SelectItem key={size} value={`${size}`}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <nav aria-label={t.gallery.pagination} className="flex items-center gap-3">
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
                    className="w-16 text-center"
                    type="number"
                    value={page}
                    onChange={(e) => {
                      const value = parseInt(e.target.value, 10)
                      if (
                        !isNaN(value) &&
                        value >= 1 &&
                        value <= Math.ceil(imageListTotal / config.pageSize)
                      ) {
                        setPage(value)
                      }
                    }}
                  />
                  <span>/{Math.ceil(imageListTotal / config.pageSize)}</span>
                  <Button
                    disabled={page * config.pageSize >= imageListTotal}
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
          </footer>
        </main>

        <PopoverControl trigger={imageViewerTrigger}>
          {({ isOpen, setOpenState }) => (
            <ImageViewer
              folders={folders}
              currentFolderId={config.activeFolder}
              isOpen={isOpen}
              onOpenChange={setOpenState}
              index={activeImageIndexInAllPages}
              total={imageListTotal}
              image={activeImage}
              onNavigate={handleNavigate}
              onTagClick={(tag) => {
                const term: SearchTerm = {
                  type: tag.type === "positive" ? "tag" : "negativeTag",
                  value: tag.name,
                  prefix: "tag:",
                  quoted: tag.name.includes(" "),
                  exclude: false,
                }
                setQuery({
                  ...query,
                  terms: [...query.terms, term],
                  activeTerm: term,
                })
              }}
            />
          )}
        </PopoverControl>
        <PopoverControl trigger={settingsTrigger}>
          {({ isOpen, setOpenState }) => (
            <SettingsDialog open={isOpen} onOpenChange={setOpenState} />
          )}
        </PopoverControl>
      </DialogContent>
    </Dialog>
  )
}

function TransferMenu({
  folders,
  currentFolderId,
  images,
  mode,
  label,
  icon,
  onComplete,
}: {
  folders?: GalleryFolder[]
  currentFolderId?: string
  images: GalleryImage[]
  mode: "copy" | "move"
  label: string
  icon: ReactNode
  onComplete: () => void
}) {
  const t = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          {icon}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {folders?.map((folder) => (
          <DropdownMenuItem
            key={folder.id}
            disabled={currentFolderId === folder.id}
            onSelect={async () => {
              if (
                images.length > 0 &&
                (await transferSelectedImages(images, folder, mode, "suggest"))
              ) {
                onComplete()
              }
            }}
          >
            <FolderIcon />
            {folder.name}
            {currentFolderId === folder.id && ` ${t.gallery.currentFolder}`}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
