import { i18n } from "../../i18n/i18n"
import { errorToast, formatError } from "../../lib/error"
import { toast } from "../../lib/toast"
import {
  FavoriteConflictError,
  GalleryImage,
  revealImage,
  sendToFavorites,
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

export async function sendImageToFavorites(image: GalleryImage, filename?: string) {
  try {
    const result = await sendToFavorites(image.id, filename)
    toast({
      type: "success",
      title: i18n.gallery.favoriteSent,
      message: result.filename,
    })
  } catch (error: unknown) {
    if (error instanceof FavoriteConflictError) {
      const replacement = await askInput(
        {
          title: i18n.gallery.favoriteConflict,
          message: i18n.gallery.favoriteConflictMessage,
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
      if (replacement) await sendImageToFavorites(image, replacement)
      return
    }
    errorToast({
      title: i18n.gallery.favoriteFailed,
      message: formatError(error),
    })
  }
}
