import { useAtom } from "jotai"
import { clamp } from "lodash-es"
import { AlertCircleIcon, ChevronLeftIcon, ChevronRightIcon, ImageIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useDebounce } from "react-use"
import { useSWRConfig } from "swr"

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
import { configAtom } from "../../lib/config"
import { formatError } from "../../lib/error"
import { emptyQuery, SearchQuery, SearchTerm } from "../../lib/search"
import { GalleryImage } from "../../services/gallery"
import { PopoverControl, usePopoverControl, usePopoverTrigger } from "../../utils/react"
import { Alert, AlertDescription, AlertTitle } from "../ui/alert"
import { Field, FieldLabel } from "../ui/field"
import { Input } from "../ui/input"
import { Label } from "../ui/label"
import { ScrollArea } from "../ui/scroll-area"
import { useFolderList, useImageQuery } from "./api"
import { FolderList } from "./folder"
import { ImageViewer } from "./ImageViewer"
import { Searchbar } from "./Searchbar"

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
  const { unload } = useSWRConfig()
  const [selectedFolderId, setSelectedFolderId] = useState("outputs")
  const [query, setQuery] = useState<SearchQuery>(emptyQuery())
  const [debouncedQuery, setDebouncedQuery] = useState<SearchQuery>(query)
  useDebounce(() => setDebouncedQuery(query), 500, [query])
  const [selectedDimensions, setSelectedDimensions] = useState<string[]>([])
  const [sort, setSort] = useState<"created_at" | "filename">("created_at")
  const [direction, setDirection] = useState<"asc" | "desc">("desc")
  const [page, setPage] = useState(1)
  const [config, setConfig] = useAtom(configAtom)
  const [selectedImage, setSelectedImage] = useState<GalleryImage | undefined>(undefined)
  const imageViewerTrigger = usePopoverTrigger()
  const [groupByDay, setGroupByDay] = useState(true)

  const { data: folders, mutate: mutateFolders } = useFolderList()

  const {
    data: imageList,
    error: imageListError,
    isLoading: imageListIsLoading,
  } = useImageQuery({
    folder: selectedFolderId,
    query: debouncedQuery,
    dimensions: selectedDimensions,
    sort,
    direction,
    page,
    pageSize: config.pageSize,
  })
  const images = imageList?.items ?? []
  const imageListTotal = imageList?.total ?? 0
  const dimensions = imageList?.dimensions ?? []

  // Clear SWR cache when the gallery is opened to ensure fresh data is fetched
  useEffect(() => {
    if (isOpen) unload()
  }, [isOpen, unload])

  const selectFolder = (folderId: string) => {
    setSelectedFolderId(folderId)
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

  const selectedFolder = folders?.find((folder) => folder.id === selectedFolderId)
  const imageGroups: [string, GalleryImage[]][] = groupByDay
    ? (Object.entries(
        images.reduce<Record<string, GalleryImage[]>>((groups, image) => {
          const day = new Date(image.created_at * 1000).toLocaleDateString()
          groups[day] = [...(groups[day] ?? []), image]
          return groups
        }, {}),
      ) as [string, GalleryImage[]][])
    : [[t.gallery.allImages, images]]
  const selectedImageIndexInCurrentPage = selectedImage
    ? images.findIndex((image) => image.id === selectedImage.id)
    : -1
  const selectedImageIndexInAllPages =
    selectedImageIndexInCurrentPage !== -1
      ? (page - 1) * config.pageSize + selectedImageIndexInCurrentPage
      : -1

  const handleNavigate = (offset: number) => {
    const currentIndex = images.findIndex((image) => image.id === selectedImage?.id)
    const nextIndex = clamp(currentIndex + offset, 0, images.length - 1)
    setSelectedImage(images[nextIndex])
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[calc(100vh-12rem)] w-375 gap-0 overflow-hidden rounded-xl bg-card p-0"
        closeButtonProps={{ size: "icon", className: "top-4 right-4" }}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <aside className="md:w-80 w-40 shrink-0 flex flex-col border-r">
          <ScrollArea className="h-full">
            <DialogHeader className="flex-row items-center gap-3 border-b p-4">
              <ImageIcon className="size-8" />
              <DialogTitle className="text-xl">{t.gallery.title}</DialogTitle>
            </DialogHeader>
            <FolderList
              folders={folders}
              selectedFolderId={selectedFolderId}
              onFolderSelect={selectFolder}
              updateTabs={mutateFolders}
            />
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
          </ScrollArea>
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
          {selectedFolder?.error && (
            <Alert variant="destructive" className="mx-4 w-fit self-start">
              <AlertCircleIcon />
              <AlertTitle>{t.gallery.folderError({ name: selectedFolder.name })}</AlertTitle>
              <AlertDescription>{formatError(selectedFolder.error)}</AlertDescription>
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
                <section className="border-b px-5 py-4 first:pt-2 last:border-b-0" key={day}>
                  {groupByDay && (
                    <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{day}</h2>
                  )}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {group.map((image) => (
                      <Button
                        className="group h-auto min-w-0 flex-col items-stretch gap-2 overflow-hidden border bg-card p-2 text-left font-normal shadow-xs hover:bg-accent"
                        key={image.id}
                        onClick={() => {
                          setSelectedImage(image)
                          imageViewerTrigger.toggle(true)
                        }}
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
            </ScrollArea>
          )}
          <footer className="flex flex-wrap items-center gap-2 border-t px-4 py-2">
            {imageList && (
              <div className="text-muted-foreground text-xs">
                {t.gallery.searchTime({ elapsed: Math.round(imageList.elapsed * 1000) })}
              </div>
            )}
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
          </footer>
        </main>

        <PopoverControl trigger={imageViewerTrigger}>
          {({ isOpen, setOpenState }) => (
            <ImageViewer
              folders={folders}
              isOpen={isOpen}
              onOpenChange={setOpenState}
              index={selectedImageIndexInAllPages}
              total={imageListTotal}
              image={selectedImage}
              onNavigate={handleNavigate}
              onTagClick={(tag, type) => {
                const term: SearchTerm = {
                  type: type === "positive" ? "tag" : "negativeTag",
                  value: tag,
                  prefix: "",
                  quoted: tag.includes(" "),
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
      </DialogContent>
    </Dialog>
  )
}
