import { i18n } from "../../i18n/i18n"
import { errorToast, formatError } from "../../lib/error"
import { toast } from "../../lib/toast"
import {
  GalleryFolder,
  GalleryImage,
  revealImage,
  TransferConflictError,
  TransferMode,
  transferImage,
} from "../../services/gallery"
import { askInput } from "../ask"

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
    const result = await transferImage(image.id, folder.id, mode, filename)
    toast({
      type: "success",
      title: mode === "copy" ? i18n.gallery.copied : i18n.gallery.moved,
      message: result.filename,
    })
  } catch (error: unknown) {
    if (error instanceof TransferConflictError) {
      const replacement = await askInput(
        {
          title: i18n.gallery.transferConflict,
          message: i18n.gallery.transferConflictMessage,
          initialValue: error.suggestedFilename,
        },
        {
          validate: (value) => {
            if (!value.trim()) {
              errorToast({
                message: i18n.error.required({ field: i18n.gallery.filename }),
              })
              return false
            }
            return true
          },
        },
      )
      if (replacement) await transferSelectedImage(image, folder, mode, replacement)
      return
    }
    errorToast({
      title: i18n.gallery.transferFailed,
      message: formatError(error),
    })
  }
}
