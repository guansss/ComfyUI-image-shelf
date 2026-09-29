import { i18n } from "../../i18n/i18n"
import { errorToast, formatError } from "../../lib/error"
import { toast } from "../../lib/toast"
import {
  GalleryFolder,
  GalleryImage,
  revealImage,
  TransferConflictError,
  TransferConflictMode,
  TransferConflictsError,
  transferImage,
  transferImages,
  TransferMode,
} from "../../services/gallery"
import { ask, AskDialog, askInput } from "../ask"
import { askConflictFilenames } from "../shared/transfer"
import { Button } from "../ui/button"

export async function revealSelectedImage(imageId: string) {
  try {
    await revealImage(imageId)
  } catch (error: unknown) {
    errorToast({
      title: i18n.gallery.revealFailed,
      message: formatError(error),
    })
  }
}

export async function transferSelectedImage(
  image: GalleryImage,
  folder: GalleryFolder,
  mode: TransferMode,
  filename?: string,
) {
  try {
    const result = await transferImage(image.id, folder.id, mode, filename, "suggest")
    toast({
      type: "success",
      title:
        mode === "copy"
          ? i18n.transfer.copied({ count: 1, folder: folder.name })
          : i18n.transfer.moved({ count: 1, folder: folder.name }),
      message: result.filename,
    })
  } catch (error: unknown) {
    if (error instanceof TransferConflictError) {
      try {
        const replacement = await askInput(
          {
            title: i18n.transfer.conflict,
            message: (
              <>
                {i18n.transfer.conflictDetails({ count: 1, total: 1 })}
                <br />
                {i18n.transfer.customizeMessage}
              </>
            ),
            initialValue: error.suggestedFilename,
          },
          {
            validate: (value) => {
              if (!value.trim()) {
                errorToast({
                  message: i18n.error.required({ field: i18n.transfer.filename }),
                })
                return false
              }
              return true
            },
          },
        )
        if (replacement) {
          await transferSelectedImage(image, folder, mode, replacement)
        }
      } catch (error: unknown) {
        errorToast({
          title: i18n.transfer.failed,
          message: formatError(error),
        })
      }
      return
    }
    errorToast({
      title: i18n.transfer.failed,
      message: formatError(error),
    })
  }
}

export async function transferSelectedImages(
  images: GalleryImage[],
  folder: GalleryFolder,
  mode: TransferMode,
  conflictMode: TransferConflictMode,
  filenames?: Record<string, string>,
): Promise<boolean> {
  try {
    const result = await transferImages(
      images.map((image) => image.id),
      folder.id,
      mode,
      conflictMode,
      filenames,
    )
    toast({
      type: "success",
      title:
        mode === "copy"
          ? i18n.transfer.copied({ count: images.length, folder: folder.name })
          : i18n.transfer.moved({ count: images.length, folder: folder.name }),
      message: result.items.map((item) => item.filename).join(", "),
    })
    return true
  } catch (error: unknown) {
    if (conflictMode !== "fail" && error instanceof TransferConflictsError) {
      try {
        const choice = await askConflictResolution(images, error.conflicts, images.length)
        if (!choice) return false

        if (choice === "rename") {
          return transferSelectedImages(images, folder, mode, "rename")
        }

        const answer = await askConflictFilenames(error.conflicts, images.length)
        if (!answer) return false

        const newFilenames: Record<string, string> = {}
        for (const [conflict, filename] of answer.replacements) {
          if ("image_id" in conflict) {
            newFilenames[conflict.image_id] = filename
          }
        }

        return transferSelectedImages(images, folder, mode, conflictMode, newFilenames)
      } catch (error: unknown) {
        errorToast({
          title: i18n.transfer.failed,
          message: formatError(error),
        })
      }
      return false
    }
    errorToast({
      title: i18n.transfer.failed,
      message: formatError(error),
    })
    return false
  }
}

function askConflictResolution(
  images: GalleryImage[],
  conflicts: TransferConflictsError["conflicts"],
  total: number,
) {
  return ask<"rename" | "customize">({
    type: "custom",
    title: i18n.transfer.conflict,
    message: i18n.transfer.conflictResolution,
    content: (
      <p className="whitespace-pre-wrap">
        {i18n.transfer.conflictDetails({ count: conflicts.length, total }) + "\n\n"}
        <span className="font-mono">
          {images
            .map(
              (image) =>
                `${conflicts.some((conflict) => "image_id" in conflict && conflict.image_id === image.id) ? "x" : "√"} ${image.filename}`,
            )
            .join("\n")}
        </span>
      </p>
    ),
    render: ({ onConfirm, onOpenChange, ...props }) => (
      <AskDialog
        {...props}
        size="medium"
        initialValue={undefined}
        confirmText={i18n.transfer.customize}
        onConfirm={() => onConfirm?.("customize")}
        action={
          <Button
            onClick={() => {
              onOpenChange?.(false)
              onConfirm?.("rename")
            }}
          >
            {i18n.transfer.rename}
          </Button>
        }
        onOpenChange={onOpenChange}
      />
    ),
  })
}
