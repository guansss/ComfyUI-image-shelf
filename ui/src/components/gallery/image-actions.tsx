import { useState } from "react"

import { i18n, useTranslation } from "../../i18n/i18n"
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
import { ask, AskDialog, askInput, AskRenderProps } from "../ask"
import { Button } from "../ui/button"
import { Field, FieldGroup, FieldLabel } from "../ui/field"
import { Input } from "../ui/input"

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
      if (replacement) await transferSelectedImage(image, folder, mode, replacement)
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
      const choice = await askConflictResolution(images, error.conflicts, images.length)
      if (!choice) return false

      if (choice === "rename") {
        return transferSelectedImages(images, folder, mode, "rename")
      }

      const customizeResult = await askCustomize(error.conflicts, images.length)
      if (!customizeResult) return false

      return transferSelectedImages(
        images,
        folder,
        mode,
        conflictMode,
        customizeResult.replacements,
      )
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
                `${conflicts.some((conflict) => conflict.image_id === image.id) ? "x" : "√"} ${image.filename}`,
            )
            .join("\n")}
        </span>
      </p>
    ),
    render: ({ onConfirm, onOpenChange, ...props }) => (
      <AskDialog
        {...props}
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

function askCustomize(conflicts: TransferConflictsError["conflicts"], total: number) {
  return ask<{ replacements: Record<string, string> }>({
    type: "custom",
    title: i18n.transfer.customize,
    message: i18n.transfer.conflictDetails({ count: conflicts.length, total }),
    render: (props) => <AskCustomizeDialog {...props} conflicts={conflicts} />,
  })
}

function AskCustomizeDialog({
  initialValue,
  conflicts,
  onConfirm,
  ...props
}: AskRenderProps<{ replacements: Record<string, string> }> & {
  conflicts: TransferConflictsError["conflicts"]
}) {
  const t = useTranslation()
  const [replacements, setReplacements] = useState<Record<string, string>>(
    conflicts.reduce<Record<string, string>>((acc, conflict) => {
      acc[conflict.image_id] = conflict.suggested_filename
      return acc
    }, {}),
  )

  return (
    <AskDialog
      {...props}
      form={true}
      content={
        <FieldGroup>
          {conflicts.map((conflict) => (
            <Field key={conflict.image_id}>
              <FieldLabel>
                <span>{t.transfer.filename}</span>
                <span className="text-muted-foreground italic truncate">{conflict.filename}</span>
              </FieldLabel>
              <Input
                aria-invalid={!replacements[conflict.image_id]}
                value={replacements[conflict.image_id]}
                onChange={(e) =>
                  setReplacements((prev) => ({ ...prev, [conflict.image_id]: e.target.value }))
                }
              />
            </Field>
          ))}
        </FieldGroup>
      }
      onConfirm={() => {
        const emptyNames = Object.entries(replacements).filter(([_, value]) => !value)
        if (emptyNames.length > 0) {
          errorToast({
            title: t.transfer.customize,
            message: i18n.error.required({ field: i18n.transfer.filename }),
          })
          return false
        }
        return onConfirm?.({ replacements })
      }}
    />
  )
}
