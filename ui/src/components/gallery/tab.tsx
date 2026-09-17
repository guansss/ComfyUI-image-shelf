import { isEqual } from "lodash-es"
import {
  CircleAlertIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FolderIcon,
  FolderSyncIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwClockIcon,
  Settings2Icon,
  SettingsIcon,
  TrashIcon,
} from "lucide-react"
import { useEffect, useState } from "react"

import { i18n, useTranslation } from "../../i18n/i18n"
import { errorToast, formatError } from "../../lib/error"
import {
  moveCustomFolder,
  readCustomFolders,
  saveCustomFolders,
  toStoredCustomFolder,
} from "../../lib/tab"
import { cn } from "../../lib/utils"
import {
  GalleryFolder,
  GalleryMessage,
  reindexFolder as reindexFolderApi,
  socket,
} from "../../services/gallery"
import { ask, askCustom, AskCustomParam, AskDialog, AskDialogProps } from "../ask"
import { usePickFolder } from "../pick-folder"
import { Button } from "../ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "../ui/field"
import { Input } from "../ui/input"
import { useFolderList } from "./api"

interface FolderListProps {
  folders?: GalleryFolder[]
  selectedFolderId?: string
  onFolderSelect: (folderId: string) => void
  updateTabs: ReturnType<typeof useFolderList>["mutate"]
}

export function FolderList({
  folders,
  selectedFolderId,
  onFolderSelect,
  updateTabs,
}: FolderListProps) {
  const t = useTranslation()
  const selectedFolder = folders?.find((folder) => folder.id === selectedFolderId)

  const removeFolder = async (folder: GalleryFolder) => {
    const confirmed = await ask({
      title: i18n.gallery.removeFolder,
      message: i18n.gallery.removeFolderMessage({ name: folder.name }),
    })
    if (!confirmed) return
    saveCustomFolders((prevFolders) =>
      prevFolders.filter((storedFolder) => storedFolder.id !== folder.id),
    )
    if (folder.id === selectedFolderId) {
      onFolderSelect("outputs")
    }
  }

  const moveFolder = (folder: GalleryFolder, direction: "up" | "down") => {
    saveCustomFolders((folders) => moveCustomFolder(folders, folder.id, direction))
  }

  const reindexFolder = async (folder: GalleryFolder, force: boolean) => {
    try {
      await reindexFolderApi(folder.id, force)
      updateTabs((current) =>
        current?.map((item) => (item.id === folder.id ? { ...item, indexing: true } : item)),
      )
    } catch (error: unknown) {
      errorToast({
        title: force ? t.gallery.reindex : t.gallery.refresh,
        message: formatError(error),
      })
    }
  }

  useEffect(() => {
    const handleFoldersUpdated = ({ folders: updatedFolders }: GalleryMessage["foldersUpdated"]) => {
      updateTabs((currentTabs) =>
        updatedFolders.map((update) => {
          const existingFolder = currentTabs?.find((folder) => folder.id === update.id)
          if (existingFolder) {
            return {
              ...existingFolder,
              ...update,
            }
          }
          return {
            ...update,
            indexing: true,
            count: 0,
            error: null,
          }
        }),
      )
    }
    const handleIndexStart = ({ folder }: GalleryMessage["indexStart"]) => {
      updateTabs((current) =>
        current?.map((item) => (item.id === folder ? { ...item, indexing: true } : item)),
      )
    }
    const handleIndexFinish = ({ folder, result, error }: GalleryMessage["indexFinish"]) => {
      updateTabs((current) =>
        current?.map((t) =>
          t.id === folder
            ? {
                ...t,
                indexing: false,
                count: result ? result.indexed + result.skipped : t.count,
                error: error ?? null,
              }
            : t,
        ),
      )
    }
    socket.on("foldersUpdated", handleFoldersUpdated)
    socket.on("indexStart", handleIndexStart)
    socket.on("indexFinish", handleIndexFinish)
    return () => {
      socket.off("foldersUpdated", handleFoldersUpdated)
      socket.off("indexStart", handleIndexStart)
      socket.off("indexFinish", handleIndexFinish)
    }
  }, [updateTabs])

  return (
    <nav className="flex flex-col gap-1 p-4 border-t">
      {folders?.map((folder) => {
        const customFolderIndex = readCustomFolders().findIndex((item) => item.id === folder.id)
        const isCustomFolder = customFolderIndex >= 0
        const customFolderCount = readCustomFolders().length
        return (
          <div
            key={folder.id}
            className={cn("flex flex-wrap rounded-md", folder === selectedFolder && "bg-(--chart-3)")}
          >
          <Button
            variant="flat"
            className={cn(
              "grow justify-start",
              folder === selectedFolder && "hover:bg-(--chart-4) dark:hover:bg-(--chart-4)",
            )}
            onClick={() => onFolderSelect(folder.id)}
          >
            {folder.id === "outputs" ? (
              <RotateCcwClockIcon data-icon="inline-start" />
            ) : (
              <FolderIcon data-icon="inline-start" />
            )}
            {folder.name}
            {folder.indexing ? (
              <LoaderCircleIcon data-icon="inline-end" className="animate-spin" />
            ) : (
              ` (${folder.count})`
            )}
            {folder.error && (
              <span title={formatError(folder.error)}>
                <CircleAlertIcon data-icon="inline-end" className="text-destructive" />
              </span>
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="flat"
                className={cn(
                  folder === selectedFolder && "hover:bg-(--chart-4) dark:hover:bg-(--chart-4)",
                )}
              >
                <SettingsIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => void reindexFolder(folder, false)}>
                  <RefreshCwIcon />
                  {t.gallery.refresh}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void reindexFolder(folder, true)}>
                  <FolderSyncIcon />
                  {t.gallery.reindex}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!folder.editable} onSelect={() => editFolder(folder)}>
                  <Settings2Icon />
                  {t.gallery.editFolder}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!isCustomFolder || customFolderIndex === 0}
                  onSelect={() => moveFolder(folder, "up")}
                >
                  <ArrowUpIcon />
                  {t.gallery.moveUp}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!isCustomFolder || customFolderIndex === customFolderCount - 1}
                  onSelect={() => moveFolder(folder, "down")}
                >
                  <ArrowDownIcon />
                  {t.gallery.moveDown}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!folder.removable}
                  onSelect={async () => void removeFolder(folder)}
                >
                  <TrashIcon />
                  {t.gallery.removeFolder}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        )
      })}
      <Button className="grow justify-start" onClick={() => void addCustomFolder()} variant="flat">
        <PlusIcon data-icon="inline-start" />
        {t.gallery.addFolder}
      </Button>
    </nav>
  )
}

const addCustomFolder = async () => {
  const result = await askCreateFolder({})
  if (!result) return
  saveCustomFolders((prevFolders) => [...prevFolders, toStoredCustomFolder(result.folder)])
}

export async function editFolder(folder: GalleryFolder) {
  const result = await askEditFolder({}, folder)
  if (!result) return
  const storedFolders = readCustomFolders()
  const storedFolder = storedFolders.find((item) => item.id === folder.id)
  if (!storedFolder) {
    console.warn(
      "[Image Shelf] editFolder: stored folder not found",
      folder.id,
      storedFolders.map((item) => item.id),
    )
    return
  }
  const newFolder = { ...storedFolder, ...toStoredCustomFolder(result.folder) }
  if (isEqual(storedFolder, newFolder)) return
  saveCustomFolders(storedFolders.map((item) => (item.id === storedFolder.id ? newFolder : item)))
}

interface EditFolderDialogValue {
  folder: GalleryFolder
}

interface EditFolderDialogMeta {
  mode: "create" | "edit"
}

function newFolder(): GalleryFolder {
  return {
    id: `custom-${crypto.randomUUID()}`,
    name: "",
    path: "",
    editable: true,
    removable: true,
    indexing: true,
    count: 0,
    error: null,
  }
}

export async function askCreateFolder(
  req: Omit<AskCustomParam<EditFolderDialogValue>, "component" | "title" | "initialValue" | "meta">,
) {
  const folder = newFolder()
  return await askCustom({
    title: i18n.gallery.addFolder,
    meta: { mode: "create" },
    initialValue: { folder },
    ...req,
    component: EditFolderDialog,
  })
}

export async function askEditFolder(
  req: Omit<
    AskCustomParam<EditFolderDialogValue, EditFolderDialogMeta>,
    "component" | "title" | "initialValue" | "meta"
  >,
  folder: GalleryFolder,
) {
  return await askCustom({
    title: i18n.gallery.editFolder,
    meta: { mode: "edit" },
    initialValue: { folder },
    ...req,
    component: EditFolderDialog,
  })
}

function EditFolderDialog({
  initialValue,
  onConfirm,
  ...props
}: AskDialogProps<EditFolderDialogValue, EditFolderDialogMeta>) {
  const t = useTranslation()
  const initialFolder = initialValue?.folder
  const [name, setName] = useState(initialFolder?.name ?? "")
  const [path, setPath] = useState(initialFolder?.path ?? "")
  const { requestPickFolder } = usePickFolder({
    onChange: (folder) => setPath(folder),
  })

  if (!initialFolder) {
    console.error("[Image Shelf] folder not provided")
    return null
  }

  const handleConfirm = () => {
    if (!name.trim()) {
      errorToast({
        title: props.meta.mode === "create" ? t.gallery.addFolder : t.gallery.editFolder,
        message: t.error.required({ field: t.gallery.folderName }),
      })
      return false
    }
    if (!path.trim()) {
      errorToast({
        title: props.meta.mode === "create" ? t.gallery.addFolder : t.gallery.editFolder,
        message: t.error.required({ field: t.filePicker.folderPath }),
      })
      return false
    }
    onConfirm?.({
      folder: {
        ...initialFolder,
        name: name.trim(),
        path: path.trim(),
      },
    })
    return true
  }

  return (
    <AskDialog
      {...props}
      content={
        <FieldGroup>
          <Field>
            <FieldLabel>
              {t.gallery.folderName}
            </FieldLabel>
            <Input
              placeholder={t.gallery.folderNamePlaceholder}
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
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
          </Field>
        </FieldGroup>
      }
      onConfirm={handleConfirm}
    />
  )
}
