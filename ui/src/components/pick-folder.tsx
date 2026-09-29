import { noop } from "lodash-es"
import { useEffect, useState } from "react"

import { i18n, useTranslation } from "../i18n/i18n"
import { errorToast, formatError, withErrorToast } from "../lib/error"
import { GalleryMessage, pickFolder, socket } from "../services/gallery"
import { ask, AskDialog, AskRenderProps, AskRequest } from "./ask"
import { Button } from "./ui/button"
import { Input } from "./ui/input"

interface useFolderPickerOptions {
  onChange: (value: string) => void
}

export function usePickFolder({ onChange }: useFolderPickerOptions) {
  useEffect(() => {
    const handlePickFolder = (data: GalleryMessage["pickFolder"]) => {
      if (data.error) {
        errorToast({
          title: i18n.filePicker.pickError,
          message: formatError(data.error),
        })
      } else if (data.path) {
        onChange(data.path)
      }
    }
    socket.on("pickFolder", handlePickFolder)
    return () => socket.off("pickFolder", handlePickFolder)
  }, [onChange])

  const requestPickFolder = async () => {
    await withErrorToast(pickFolder(), i18n.filePicker.pickError).catch(noop)
  }
  return { requestPickFolder }
}

interface PickFolderDialogValue {
  folder: string
}

export async function askPickFolder(req: Omit<AskRequest<PickFolderDialogValue>, "render">) {
  return await ask({ ...req, render: PickFolderDialog })
}

function PickFolderDialog({
  initialValue,
  onConfirm,
  ...props
}: AskRenderProps<PickFolderDialogValue>) {
  const t = useTranslation()
  const [value, setValue] = useState(initialValue?.folder ?? "")
  const { requestPickFolder } = usePickFolder({
    onChange: (folder) => setValue(folder),
  })

  return (
    <AskDialog
      {...props}
      size="medium"
      content={
        <div className="flex flex-col items-end gap-2">
          <Button variant="outline" onClick={requestPickFolder}>
            {t.filePicker.pickFolder}
          </Button>
          <Input
            placeholder={t.filePicker.folderPlaceholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
      }
      onConfirm={() => onConfirm?.({ folder: value })}
    />
  )
}
