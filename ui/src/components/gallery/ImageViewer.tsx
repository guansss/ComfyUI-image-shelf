import { useAtom, useAtomValue } from "jotai"
import { FolderOpenIcon, StarIcon } from "lucide-react"
import { ReactNode, useEffect, useMemo, useRef } from "react"
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
import { replaceTags } from "../../lib/metadata"
import { GalleryImage, PromptParseResult } from "../../services/gallery"
import { joinJSX } from "../../utils/react"
import { ScrollArea } from "../ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"
import { Separator } from "../ui/separator"
import { useImageDetails } from "./api"
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

  const { prompts, negativePrompts, generationInfo, metadataError } = useMemo(() => {
    const metadata = imageDetails?.metadata
    if (metadata?.parse_error) {
      return { metadataError: metadata.parse_error }
    }
    if (metadata?.type === "comfy") {
      const prompt = metadata.prompt as PromptParseResult
      return {
        generationInfo: JSON.stringify(metadata.info, null, 2),
        prompts: prompt.matches
          .filter((match) => match.role === "positive")
          .map((match) => match.text),
        negativePrompts: prompt.matches
          .filter((match) => match.role === "negative")
          .map((match) => match.text),
      }
    } else if (metadata?.type === "a1111") {
      const prompt = metadata.prompt as Record<string, string>
      return {
        generationInfo: metadata.info as string,
        prompts: prompt.prompt ? [prompt.prompt] : undefined,
        negativePrompts: prompt.negative_prompt ? [prompt.negative_prompt] : undefined,
      }
    }
    return {}
  }, [imageDetails?.metadata])

  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-screen! w-screen h-screen flex gap-0 overflow-hidden p-0 bg-transparent"
        closeButtonProps={{ size: "icon", className: "size-12 top-4 right-4 p-2" }}
      >
        <aside className="md:w-80 w-40 shrink-0 border-r bg-card">
          <ScrollArea className="h-full">
            <DialogHeader className="p-4 border-b wrap-break-word">
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
                <dl className="grid grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-4">
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
                      prompts={prompts}
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
                      prompts={negativePrompts}
                      tags={imageDetails.negative_tags}
                      onTagClick={(tag) => {
                        onTagClick?.(tag, "negative")
                        onOpenChange(false)
                      }}
                    />
                  </dd>
                  {imageDetails.parse_error && (
                    <>
                      <dt className="text-muted-foreground border-t pt-2">
                        {t.gallery.metadataWarning}
                      </dt>
                      <dd className="wrap-break-word text-destructive">
                        {imageDetails.parse_error}
                      </dd>
                    </>
                  )}
                  <dt className="text-muted-foreground border-t pt-2">
                    {t.gallery.generationInfo}
                  </dt>
                  <dd className="wrap-break-word">
                    {metadataError ? (
                      <span className="text-destructive">{metadataError}</span>
                    ) : generationInfo ? (
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline">{t.common.view}</Button>
                        </DialogTrigger>
                        <DialogContent className="sm:min-w-sm">
                          <DialogHeader>
                            <DialogTitle>{t.gallery.generationInfo}</DialogTitle>
                          </DialogHeader>
                          <textarea
                            className="h-[80vh] overflow-y-auto font-mono"
                            readOnly
                            value={generationInfo}
                          />
                          <DialogFooter>
                            <Button onClick={() => void copyToClipboard(generationInfo)}>
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
          </ScrollArea>
        </aside>
        <main className="grow flex flex-col" onClick={() => onOpenChange(false)}>
          <img alt={image?.filename} className="size-full object-contain" src={image?.url} />
        </main>
      </DialogContent>
    </Dialog>
  )
}

function PromptText({
  prompts,
  tags,
  onTagClick,
}: {
  prompts?: string[]
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
    if (config.promptDisplayMode === "raw") {
      return prompts && joinJSX(prompts, <Separator />)
    }
    if (config.promptDisplayMode === "tags") {
      return joinJSX(
        [...tags]
          .sort((a, b) => a.localeCompare(b))
          .map((tag) => (
            <TagLink key={tag} tag={tag} onClick={(tag) => onClickRef.current?.(tag)}>
              {tag}
            </TagLink>
          )),
        "\n",
      )
    }
    if (!prompts?.length) {
      return undefined
    }

    return (
      <div className="text-muted-foreground">
        {joinJSX(
          prompts.map((prompt) =>
            replaceTags(prompt, tags, (tag, matchedText, occurrence) => (
              <TagLink
                key={`${tag}-${occurrence}`}
                tag={tag}
                onClick={(tag) => onClickRef.current?.(tag)}
              >
                {matchedText}
              </TagLink>
            )),
          ),
          <Separator />,
        )}
      </div>
    )
  }, [prompts, tags, config])

  const isEmpty = !content || (Array.isArray(content) && content.length === 0)
  return isEmpty ? t.gallery.noInfo : content
}

function TagLink({
  tag,
  children,
  onClick,
}: {
  tag: string
  children: ReactNode
  onClick?: (tag: string) => void
}) {
  const onClickRef = useRef(onClick)

  useEffect(() => {
    onClickRef.current = onClick
  }, [onClick])

  return (
    <a
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
      {children}
    </a>
  )
}
