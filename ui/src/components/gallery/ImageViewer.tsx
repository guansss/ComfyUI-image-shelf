import { useAtom, useAtomValue } from "jotai"
import { ChevronLeftIcon, ChevronRightIcon, FolderOpenIcon, InfoIcon, StarIcon } from "lucide-react"
import { Fragment, ReactNode, useEffect, useMemo, useRef } from "react"
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

import { ComfyApiWorkflow, ComfyWorkflowJSON } from "../../comfy-shims"
import { useTranslation } from "../../i18n/i18n"
import { configAtom } from "../../lib/config"
import { copyToClipboard } from "../../lib/dom"
import { replaceTags } from "../../lib/metadata"
import { GalleryImage, ImageDetails, PromptParseResult } from "../../services/gallery"
import { joinJSX } from "../../utils/react"
import { Badge } from "../ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { ScrollArea } from "../ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"
import { useImageDetails } from "./api"
import { revealSelectedImage, sendImageToFavorites } from "./helpers"

const ROLE_COLORS: Record<string, string> = {
  positive: "bg-sky-50 text-sky-700 dark:bg-sky-900 dark:text-sky-200",
  negative: "bg-amber-50 text-amber-700 dark:bg-amber-900 dark:text-amber-200",
  unknown: "bg-gray-50 text-gray-700 dark:bg-gray-900 dark:text-gray-200",
}

const ROLE_ORDER: string[] = ["positive", "negative", "unknown"]

interface ImageViewerProps extends MetadataProps {
  index?: number
  total?: number
  image?: GalleryImage
  isOpen: boolean
  onNavigate?: (offset: number) => void
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
              <div className="flex flex-col text-sm">
                <dl className="grid grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-2 border-b">
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
                {imageDetails.parse_error && (
                  <dl className="flex flex-col gap-2 px-4 py-2 border-b">
                    <dt className="text-muted-foreground">{t.gallery.metadataWarning}</dt>
                    <dd className="wrap-break-word text-destructive">{imageDetails.parse_error}</dd>
                  </dl>
                )}
                <Metadata
                  imageDetails={imageDetails}
                  onOpenChange={onOpenChange}
                  onTagClick={onTagClick}
                />
              </div>
            ) : (
              <p className="mt-5 text-sm text-muted-foreground">{t.gallery.loading}</p>
            )}
          </ScrollArea>
        </aside>
        <main
          className="relative grow flex flex-col"
          onClick={() => onOpenChange(false)}
          onWheel={(e) => {
            e.stopPropagation()
            onNavigate?.(e.deltaY > 0 ? 1 : -1)
          }}
        >
          <img alt={image?.filename} className="size-full object-contain" src={image?.url} />
          {onNavigate && (
            <div className="absolute top-1/2 left-0 -translate-y-1/2">
              <Button
                className="px-0 py-12"
                onClick={(e) => {
                  e.stopPropagation()
                  onNavigate(-1)
                }}
                size={null}
                variant="flat"
              >
                <ChevronLeftIcon className="size-16" />
              </Button>
            </div>
          )}
          {onNavigate && (
            <div className="absolute top-1/2 right-0 -translate-y-1/2">
              <Button
                className="px-0 py-12"
                onClick={(e) => {
                  e.stopPropagation()
                  onNavigate(1)
                }}
                size={null}
                variant="flat"
              >
                <ChevronRightIcon className="size-16" />
              </Button>
            </div>
          )}
        </main>
      </DialogContent>
    </Dialog>
  )
}

interface MetadataProps {
  imageDetails: ImageDetails
  onTagClick?: (tag: string, type: "positive" | "negative") => void
  onOpenChange: (open: boolean) => void
}

function Metadata({ imageDetails, onTagClick, onOpenChange }: MetadataProps) {
  const t = useTranslation()
  const [config, setConfig] = useAtom(configAtom)

  const { type, prompt, info, parse_error } = imageDetails.metadata || {}

  const [infoText, comfyWorkflows] = useMemo(() => {
    if (!info) {
      return [undefined, undefined]
    }
    if (type === "comfy") {
      return [
        JSON.stringify(info, null, 2),
        info as { workflow: ComfyWorkflowJSON; prompt: ComfyApiWorkflow },
      ]
    } else if (type === "a1111") {
      return [info as string, undefined]
    }
    return [undefined, undefined]
  }, [type, info])

  if (!imageDetails?.metadata) {
    return null
  }

  return (
    <dl className="flex flex-col gap-2 py-2">
      <dt className="text-muted-foreground flex items-center justify-between px-4">
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
      {type === "comfy" &&
        (prompt as PromptParseResult | null)?.matches
          .sort(
            (a, b) =>
              (ROLE_ORDER.indexOf(a.role) + 1 || 999) - (ROLE_ORDER.indexOf(b.role) + 1 || 999) ||
              b.score - a.score ||
              b.text.length - a.text.length,
          )
          .map(({ node_id, input_name, role, text, score, path, reason }) => {
            const getNode = (id: string) => comfyWorkflows?.prompt[id]
            const getDisplayName = (id: string) => getNode(id)?._meta.title || id
            const node = getNode(node_id)
            path = path.slice().reverse()

            return (
              <Fragment key={node_id + input_name + role + text}>
                <dt className="flex gap-2 items-center px-4 text-muted-foreground">
                  <Badge className={ROLE_COLORS[role] || ROLE_COLORS.unknown}>{role}</Badge>
                  <span className="truncate">{getDisplayName(node_id)}</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="flat" size="icon-sm" className="ml-auto">
                        <InfoIcon />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto max-w-screen whitespace-pre-wrap font-mono">
                      {`Node ID: ${node_id}
Node Name: ${getDisplayName(node_id)}
Node Class: ${node?.class_type ?? "N/A"}
Input Name: ${input_name}
Role: ${role}
Match Reason: ${reason}
Score: ${score}
---
Path:
${path.reduce((acc, p, i) => `${i > 0 ? acc + "\n→ " : acc}${p.input_name}[${getDisplayName(p.node_id)}]${p.output_index ?? ""}`, "  ")}
`}
                    </PopoverContent>
                  </Popover>
                </dt>
                <dd className="px-4">
                  <PromptText
                    prompt={text}
                    tags={role === "negative" ? imageDetails.negative_tags : imageDetails.tags}
                    onTagClick={(tag) => {
                      onTagClick?.(tag, role === "negative" ? "negative" : "positive")
                      onOpenChange(false)
                    }}
                  />
                </dd>
              </Fragment>
            )
          })}
      {type === "a1111" && (
        <>
          <dt className="px-4">
            <Badge className={ROLE_COLORS["positive"]}>positive</Badge>
          </dt>
          <dd className="px-4 wrap-break-word whitespace-pre-wrap">
            <PromptText
              prompt={(prompt as Record<string, string> | null)?.prompt}
              tags={imageDetails.tags}
              onTagClick={(tag) => {
                onTagClick?.(tag, "positive")
                onOpenChange(false)
              }}
            />
          </dd>
          <dt className="px-4">
            <Badge className={ROLE_COLORS["negative"]}>negative</Badge>
          </dt>
          <dd className="px-4 wrap-break-word whitespace-pre-wrap">
            <PromptText
              prompt={(prompt as Record<string, string> | null)?.negative_prompt}
              tags={imageDetails.negative_tags}
              onTagClick={(tag) => {
                onTagClick?.(tag, "negative")
                onOpenChange(false)
              }}
            />
          </dd>
        </>
      )}
      <dt className="text-muted-foreground border-t px-4 py-2">{t.gallery.generationInfo}</dt>
      <dd className="wrap-break-word px-4">
        {parse_error ? (
          <span className="text-destructive">{parse_error}</span>
        ) : infoText ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">{t.common.view}</Button>
            </DialogTrigger>
            <DialogContent className="sm:min-w-sm">
              <DialogHeader>
                <DialogTitle>{t.gallery.generationInfo}</DialogTitle>
              </DialogHeader>
              <textarea className="h-[80vh] overflow-y-auto font-mono" readOnly value={infoText} />
              <DialogFooter>
                <Button onClick={() => void copyToClipboard(infoText)}>{t.common.copy}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : (
          t.gallery.noInfo
        )}
      </dd>
    </dl>
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
    if (config.promptDisplayMode === "raw") {
      return prompt
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
    if (!prompt?.length) {
      return undefined
    }

    return (
      <div className="text-muted-foreground">
        {replaceTags(prompt, tags, (tag, matchedText, occurrence) => (
          <TagLink
            key={`${tag}-${occurrence}`}
            tag={tag}
            onClick={(tag) => onClickRef.current?.(tag)}
          >
            {matchedText}
          </TagLink>
        ))}
      </div>
    )
  }, [prompt, tags, config])

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
