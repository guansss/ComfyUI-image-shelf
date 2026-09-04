import { noop } from "lodash-es"
import { useEffect, useState } from "react"

import { GalleryMessage, pickFolder as pickFolderApi, socket } from "../galleryApi"
import { i18n, useTranslation } from "../i18n/i18n"
import { errorToast, formatError, withErrorToast } from "../lib/error"
import { askCustom, AskCustomParam, AskDialog, AskDialogProps } from "./ask"
import { Button } from "./ui/button"
import { Input } from "./ui/input"

interface PickFolderValue {
  folder: string
}

export async function pickFolder(req: Omit<AskCustomParam<PickFolderValue>, "component">) {
  return await askCustom({
    ...req,
    component: PickFolderDialog,
  })
}

interface PickFolderDialogProps extends AskDialogProps<PickFolderValue> {}

export function PickFolderDialog({ initialValue, onConfirm, ...props }: PickFolderDialogProps) {
  const t = useTranslation()
  const [value, setValue] = useState(initialValue?.folder ?? "")

  useEffect(() => {
    const handlePickFolder = (data: GalleryMessage["pickFolder"]) => {
      if (data.error) {
        errorToast({
          title: i18n.filePicker.pickError,
          message: formatError(data.error),
        })
      } else if (data.path) {
        setValue(data.path)
      }
    }
    socket.on("pickFolder", handlePickFolder)
    return () => socket.off("pickFolder", handlePickFolder)
  }, [])

  const requestPickFolder = async () => {
    await withErrorToast(pickFolderApi(), t.filePicker.pickError).catch(noop)
  }

  return (
    <AskDialog
      {...props}
      content={
        <div className="flex flex-col items-end gap-2">
          <Button variant="outline" onClick={requestPickFolder}>
            {t.filePicker.selectFolder}
          </Button>
          <Input value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
      }
      onConfirm={() => onConfirm?.({ folder: value })}
    />
  )
}
