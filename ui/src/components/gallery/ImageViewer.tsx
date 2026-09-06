import { FolderOpenIcon, StarIcon } from "lucide-react"
import { useEffect } from "react"
import { noop } from "swr/_internal"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

import { useTranslation } from "../../i18n/i18n"
import { GalleryImage } from "../../services/gallery"
import { useImageDetails } from "./api"
import { revealSelectedImage, sendImageToFavorites } from "./helpers"

interface ImageViewerProps {
  image?: GalleryImage
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onNavigate?: (offset: number) => void
}

export function ImageViewer({ image, isOpen, onOpenChange, onNavigate }: ImageViewerProps) {
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
        <aside className="w-80 overflow-y-auto border-r bg-card">
          <DialogHeader className="p-4 border-b">
            <DialogTitle>{image?.filename}</DialogTitle>
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
            <dl className="mt-4 p-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
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
              {imageDetails.tags.length > 0 && (
                <>
                  <dt className="text-muted-foreground">{t.gallery.tags}</dt>
                  <dd className="wrap-break-word">{imageDetails.tags.join(", ")}</dd>
                </>
              )}
              {imageDetails.negative_tags.length > 0 && (
                <>
                  <dt className="text-muted-foreground">{t.gallery.negativeTags}</dt>
                  <dd className="wrap-break-word">{imageDetails.negative_tags.join(", ")}</dd>
                </>
              )}
              {imageDetails.parse_error && (
                <>
                  <dt className="text-muted-foreground">{t.gallery.metadataWarning}</dt>
                  <dd className="wrap-break-word">{imageDetails.parse_error}</dd>
                </>
              )}
            </dl>
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
