import { useAtom, useAtomValue } from "jotai"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyPlusIcon,
  FileInputIcon,
  FolderIcon,
  FolderOpenIcon,
  InfoIcon,
} from "lucide-react"
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
import {
  GalleryFolder,
  GalleryImage,
  ImageDetails,
  PromptParseResult,
  TagSuggestion,
} from "../../services/gallery"
import { joinJSX } from "../../utils/react"
import { Badge } from "../ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"
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
import { revealSelectedImage, transferSelectedImage } from "./helpers"

const ROLE_COLORS: Record<string, string> = {
  positive: "bg-sky-50 text-sky-700 dark:bg-sky-900 dark:text-sky-200",
  negative: "bg-amber-50 text-amber-700 dark:bg-amber-900 dark:text-amber-200",
  unknown: "bg-gray-50 text-gray-700 dark:bg-gray-900 dark:text-gray-200",
}

const ROLE_ORDER: string[] = ["positive", "negative", "unknown"]

interface ImageViewerProps extends Pick<MetadataProps, "onTagClick"> {
  index?: number
  total?: number
  image?: GalleryImage
  folders?: GalleryFolder[]
  currentFolderId?: string
  isOpen: boolean
  onNavigate?: (offset: number) => void
  onOpenChange: (isOpen: boolean) => void
}

export function ImageViewer({
  image,
  isOpen,
  onOpenChange,
  onNavigate,
  index,
  total,
  onTagClick,
  folders,
  currentFolderId,
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
              <TransferMenu
                folders={folders}
                currentFolderId={currentFolderId}
                image={image}
                mode="copy"
                label={t.gallery.copyTo}
                icon={<CopyPlusIcon data-icon="inline-start" />}
              />
              <TransferMenu
                folders={folders}
                currentFolderId={currentFolderId}
                image={image}
                mode="move"
                label={t.gallery.moveTo}
                icon={<FileInputIcon data-icon="inline-start" />}
              />
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
                  onTagClick={(tag) => {
                    onTagClick?.(tag)
                    onOpenChange(false)
                  }}
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

function TransferMenu({
  folders,
  currentFolderId,
  image,
  mode,
  label,
  icon,
}: {
  folders?: GalleryFolder[]
  currentFolderId?: string
  image?: GalleryImage
  mode: "copy" | "move"
  label: string
  icon: ReactNode
}) {
  const t = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          {icon}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {folders?.map((folder) => (
          <DropdownMenuItem
            key={folder.id}
            disabled={currentFolderId === folder.id}
            onSelect={() => image && transferSelectedImage(image, folder, mode)}
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

interface MetadataProps {
  imageDetails: ImageDetails
  onTagClick?: (tag: TagSuggestion) => void
}

function Metadata({ imageDetails, onTagClick }: MetadataProps) {
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
      {config.promptDisplayMode === "tags" && (
        <>
          <dt className="px-4">
            <Badge className={ROLE_COLORS["positive"]}>positive</Badge>
          </dt>
          <dd className="px-4 wrap-break-word whitespace-pre-wrap">
            <Tags
              tags={imageDetails.tags.filter((tag) => tag.type === "positive")}
              onTagClick={(tag) => onTagClick?.(tag)}
            />
          </dd>
          <dt className="px-4">
            <Badge className={ROLE_COLORS["negative"]}>negative</Badge>
          </dt>
          <dd className="px-4 wrap-break-word whitespace-pre-wrap">
            <Tags
              tags={imageDetails.tags.filter((tag) => tag.type === "negative")}
              onTagClick={(tag) => onTagClick?.(tag)}
            />
          </dd>
        </>
      )}
      {config.promptDisplayMode !== "tags" &&
        type === "comfy" &&
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
                <dd className="px-4 wrap-break-word whitespace-pre-wrap">
                  <PromptText
                    prompt={text}
                    tags={imageDetails.tags.filter(
                      (tag) => tag.type === (role === "negative" ? "negative" : "positive"),
                    )}
                    onTagClick={onTagClick}
                  />
                </dd>
              </Fragment>
            )
          })}
      {config.promptDisplayMode !== "tags" && type === "a1111" && (
        <>
          <dt className="px-4">
            <Badge className={ROLE_COLORS["positive"]}>positive</Badge>
          </dt>
          <dd className="px-4 wrap-break-word whitespace-pre-wrap">
            <PromptText
              prompt={(prompt as Record<string, string> | null)?.prompt}
              tags={imageDetails.tags.filter((tag) => tag.type === "positive")}
              onTagClick={onTagClick}
            />
          </dd>
          <dt className="px-4">
            <Badge className={ROLE_COLORS["negative"]}>negative</Badge>
          </dt>
          <dd className="px-4 wrap-break-word whitespace-pre-wrap">
            <PromptText
              prompt={(prompt as Record<string, string> | null)?.negative_prompt}
              tags={imageDetails.tags.filter((tag) => tag.type === "negative")}
              onTagClick={onTagClick}
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

function Tags({
  tags,
  onTagClick,
}: {
  tags: TagSuggestion[]
  onTagClick?: (tag: TagSuggestion) => void
}) {
  return joinJSX(
    [...tags]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tag) => (
        <Fragment key={tag.name}>
          <TagLink key={tag.name} tag={tag} onClick={onTagClick}>
            {tag.name}
          </TagLink>
          <span className="ml-2 text-muted-foreground text-xs">{tag.count}</span>
        </Fragment>
      )),
    "\n",
  )
}

function PromptText({
  prompt,
  tags,
  onTagClick,
}: {
  prompt?: string
  tags: TagSuggestion[]
  onTagClick?: (tag: TagSuggestion) => void
}) {
  const t = useTranslation()
  const config = useAtomValue(configAtom)

  const content = useMemo(() => {
    if (config.promptDisplayMode !== "both") {
      return prompt
    }
    if (!prompt?.length) {
      return undefined
    }

    return (
      <div className="text-muted-foreground">
        {replaceTags(
          prompt,
          tags.map((tag) => tag.name),
          (tag, matchedText, occurrence) => (
            <TagLink
              key={`${tag}-${occurrence}`}
              tag={tags.find((t) => t.name === tag)!}
              onClick={onTagClick}
            >
              {matchedText}
            </TagLink>
          ),
        )}
      </div>
    )
  }, [prompt, tags, config, onTagClick])

  const isEmpty = !content || (Array.isArray(content) && content.length === 0)
  return isEmpty ? t.gallery.noInfo : content
}

function TagLink({
  tag,
  children,
  onClick,
}: {
  tag: TagSuggestion
  children: ReactNode
  onClick?: (tag: TagSuggestion) => void
}) {
  const onClickRef = useRef(onClick)

  useEffect(() => {
    onClickRef.current = onClick
  }, [onClick])

  return (
    <a
      role="button"
      className="text-foreground cursor-pointer hover:underline"
      title={`${tag.name} (${tag.count})`}
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
