import { useState } from "react"

import { GalleryTab } from "../../galleryApi"
import { i18n, useTranslation } from "../../i18n/i18n"
import { errorToast } from "../../lib/error"
import { askCustom, AskCustomParam, AskDialog, AskDialogProps } from "../ask"
import { usePickFolder } from "../pick-folder"
import { Button } from "../ui/button"
import { Field, FieldGroup, FieldLabel } from "../ui/field"
import { Input } from "../ui/input"

interface EditTabDialogValue {
  tab: GalleryTab
}

interface EditTabDialogMeta {
  mode: "create" | "edit"
}

function newTab(): GalleryTab {
  return {
    id: `custom-${crypto.randomUUID()}`,
    name: "",
    folders: [],
    editable: true,
    removable: true,
    indexing: true,
    count: 0,
    error: null,
  }
}

export async function askCreateTab(
  req: Omit<AskCustomParam<EditTabDialogValue>, "component" | "title" | "initialValue" | "meta">,
) {
  const tab: GalleryTab = newTab()
  return await askCustom({
    title: i18n.gallery.addTab,
    meta: { mode: "create" },
    initialValue: { tab },
    ...req,
    component: EditTabDialog,
  })
}

export async function askEditTab(
  req: Omit<
    AskCustomParam<EditTabDialogValue, EditTabDialogMeta>,
    "component" | "title" | "initialValue" | "meta"
  >,
  tab: GalleryTab,
) {
  return await askCustom({
    title: i18n.gallery.editTab,
    meta: { mode: "edit" },
    initialValue: { tab },
    ...req,
    component: EditTabDialog,
  })
}

function EditTabDialog({
  initialValue,
  onConfirm,
  ...props
}: AskDialogProps<EditTabDialogValue, EditTabDialogMeta>) {
  const t = useTranslation()
  const initialTab = initialValue?.tab
  const [name, setName] = useState(initialTab?.name ?? "")
  const [folder, setFolder] = useState(initialTab?.folders[0] ?? "")
  const { requestPickFolder } = usePickFolder({
    onChange: (folder) => setFolder(folder),
  })

  if (!initialTab) {
    console.error("[Image Shelf] tab not provided")
    return null
  }

  const handleConfirm = () => {
    if (!name.trim()) {
      errorToast({
        title: props.meta.mode === "create" ? t.gallery.addTab : t.gallery.editTab,
        message: t.error.required({ field: t.gallery.tabName }),
      })
      return false
    }
    if (!folder.trim()) {
      errorToast({
        title: props.meta.mode === "create" ? t.gallery.addTab : t.gallery.editTab,
        message: t.error.required({ field: t.filePicker.folderPath }),
      })
      return false
    }
    onConfirm?.({
      tab: {
        ...initialTab,
        name: name.trim(),
        folders: folder.trim() ? [folder] : [],
      },
    })
    return true
  }

  const renamable = initialTab.id !== "favorites"

  return (
    <AskDialog
      {...props}
      content={
        <FieldGroup>
          <Field>
            <FieldLabel>
              {t.gallery.tabName}
              {!renamable && (
                <span className="ml-2 text-sm italic text-muted"> ({t.gallery.cannotEdit})</span>
              )}
            </FieldLabel>
            <Input
              placeholder={t.gallery.tabNamePlaceholder}
              disabled={!renamable}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel className="flex items-center justify-between">
              {t.filePicker.folderPath}
              <Button variant="outline" onClick={requestPickFolder}>
                {t.filePicker.pickFolder}
              </Button>
            </FieldLabel>
            <Input
              placeholder={t.filePicker.folderPlaceholder}
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
            />
          </Field>
        </FieldGroup>
      }
      onConfirm={handleConfirm}
    />
  )
}
