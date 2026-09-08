import { useAtom, useAtomValue } from "jotai"
import { FolderOpenIcon, StarIcon } from "lucide-react"
import { useEffect, useMemo, useRef } from "react"
import { noop } from "swr/_internal"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

import { useTranslation } from "../../i18n/i18n"
import { configAtom } from "../../lib/config"
import { copyToClipboard } from "../../lib/dom"
import { formatError } from "../../lib/error"
import { GalleryImage } from "../../services/gallery"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"
import { useImageDetails, useImageMetadata } from "./api"
import { revealSelectedImage, sendImageToFavorites } from "./helpers"

interface ImageViewerProps {
  index?: number
  total?: number
  image?: GalleryImage
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onNavigate?: (offset: number) => void
  onTagClick?: (tag: string, type: "positive" | "negative") => void
}

export function ImageViewer({
  image,
  isOpen,
  onOpenChange,
  onNavigate,
  index,
  total,
  onTagClick,
}: ImageViewerProps) {
  const t = useTranslation()
  const [config, setConfig] = useAtom(configAtom)
  const { data: imageDetails } = useImageDetails({ imageId: image?.id })
  const { data: metadata, error: metadataError } = useImageMetadata({
    filename: image?.filename,
    url: image?.url,
  })

  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        onNavigate?.(-1)
      } else if (event.key === "ArrowRight") {
        onNavigate?.(1)
      }
    }
    window.addEventListener("keydown", navigate)
    return () => window.removeEventListener("keydown", navigate)
  }, [onNavigate])

  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-screen! w-screen h-screen flex gap-0 overflow-hidden p-0 bg-transparent"
        closeButtonProps={{ size: "icon", className: "size-12 top-4 right-4 p-2" }}
      >
        <aside className="w-80 min-w-40 shrink overflow-y-auto border-r bg-card">
          <DialogHeader className="p-4 border-b">
            <DialogTitle>{image?.filename}</DialogTitle>
            {index !== undefined && total !== undefined && (
              <p className="text-sm text-muted-foreground">
                ({index + 1}/{total})
              </p>
            )}
          </DialogHeader>
          <div className="flex flex-wrap gap-2 p-4 border-b">
            <Button onClick={() => image && sendImageToFavorites(image).catch(noop)} size="sm">
              <StarIcon data-icon="inline-start" />
              {t.gallery.sendToFavorites}
            </Button>
            <Button
              onClick={() => image && revealSelectedImage(image.id).catch(noop)}
              size="sm"
              variant="outline"
            >
              <FolderOpenIcon data-icon="inline-start" />
              {t.gallery.reveal}
            </Button>
          </div>
          {imageDetails ? (
            <div className="flex flex-col gap-2 py-2 border-t text-sm">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-4">
                <dt className="text-muted-foreground">{t.gallery.dimensions}</dt>
                <dd className="wrap-break-word">
                  {imageDetails.width} x {imageDetails.height}
                </dd>
                <dt className="text-muted-foreground">{t.gallery.creationDate}</dt>
                <dd className="wrap-break-word">
                  {new Date(imageDetails.created_at * 1000).toLocaleString()}
                </dd>
                <dt className="text-muted-foreground">{t.gallery.fileSize}</dt>
                <dd className="wrap-break-word">{Math.ceil(imageDetails.file_size / 1024)} KB</dd>
              </dl>
              <dl className="flex flex-col gap-2 px-4">
                <dt className="text-muted-foreground flex items-center justify-between border-t pt-2">
                  {t.gallery.tags}
                  <Select
                    onValueChange={(value) =>
                      setConfig({ promptDisplayMode: value as "tags" | "raw" | "both" })
                    }
                    value={config.promptDisplayMode}
                  >
                    <SelectTrigger title={t.viewer.promptModeSelect} className="basis-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="tags">{t.viewer.promptMode.tags}</SelectItem>
                        <SelectItem value="raw">{t.viewer.promptMode.raw}</SelectItem>
                        <SelectItem value="both">{t.viewer.promptMode.both}</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </dt>
                <dd className="wrap-break-word whitespace-pre-wrap">
                  <PromptText
                    prompt={metadata?.positivePrompt}
                    tags={imageDetails.tags}
                    onTagClick={(tag) => {
                      onTagClick?.(tag, "positive")
                      onOpenChange(false)
                    }}
                  />
                </dd>
                <dt className="text-muted-foreground border-t pt-2">{t.gallery.negativeTags}</dt>
                <dd className="wrap-break-word whitespace-pre-wrap">
                  <PromptText
                    prompt={metadata?.negativePrompt}
                    tags={imageDetails.negative_tags}
                    onTagClick={(tag) => {
                      onTagClick?.(tag, "negative")
                      onOpenChange(false)
                    }}
                  />
                </dd>
                {imageDetails.parse_error && (
                  <>
                    <dt className="text-muted-foreground border-t pt-2">{t.gallery.metadataWarning}</dt>
                    <dd className="wrap-break-word text-destructive">{imageDetails.parse_error}</dd>
                  </>
                )}
                <dt className="text-muted-foreground border-t pt-2">{t.gallery.workflow}</dt>
                <dd className="wrap-break-word">
                  {metadataError ? (
                    <span className="text-destructive">{formatError(metadataError)}</span>
                  ) : metadata?.workflowText ? (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline">{t.common.view}</Button>
                      </DialogTrigger>
                      <DialogContent className="sm:min-w-sm">
                        <DialogHeader>
                          <DialogTitle>{t.gallery.workflow}</DialogTitle>
                        </DialogHeader>
                        <textarea
                          className="h-[80vh] overflow-y-auto font-mono"
                          readOnly
                          value={metadata.workflowText}
                        />
                        <DialogFooter>
                          <Button onClick={() => void copyToClipboard(metadata.workflowText)}>
                            {t.common.copy}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  ) : (
                    t.gallery.noInfo
                  )}
                </dd>
              </dl>
            </div>
          ) : (
            <p className="mt-5 text-sm text-muted-foreground">{t.gallery.loading}</p>
          )}
        </aside>
        <main className="grow flex flex-col" onClick={() => onOpenChange(false)}>
          <img alt={image?.filename} className="size-full object-contain" src={image?.url} />
        </main>
      </DialogContent>
    </Dialog>
  )
}

function PromptText({
  prompt,
  tags,
  onTagClick,
}: {
  prompt?: string
  tags: string[]
  onTagClick?: (tag: string) => void
}) {
  const t = useTranslation()
  const config = useAtomValue(configAtom)
  const onClickRef = useRef(onTagClick)

  useEffect(() => {
    onClickRef.current = onTagClick
  }, [onTagClick])

  const content = useMemo(() => {
    if (!prompt && !tags.length) {
      return t.gallery.noInfo
    }
    if (config.promptDisplayMode === "raw" || !tags.length) {
      return prompt
    }
    if (config.promptDisplayMode === "tags" || !prompt) {
      return tags.join(", ")
    }

    const sortedTags = [...tags].sort((a, b) => b.length - a.length) // Sort tags by length to avoid partial matches

    return (
      <div className="text-muted-foreground">
        {prompt.split(",").flatMap((value, index) => {
          for (const tag of sortedTags) {
            if (value.includes(tag)) {
              const [head, tail] = value.split(tag)
              return [
                index === 0 ? head : "," + head,
                <a
                  key={tag}
                  role="button"
                  className="text-foreground cursor-pointer hover:underline"
                  onClick={(e) => {
                    e.preventDefault()
                    onClickRef.current?.(tag)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onClickRef.current?.(tag)
                    }
                  }}
                  tabIndex={0}
                >
                  {tag}
                </a>,
                tail,
              ]
            }
          }
          return index === 0 ? value : "," + value
        })}
      </div>
    )
  }, [t, prompt, tags, config])

  return content
}
