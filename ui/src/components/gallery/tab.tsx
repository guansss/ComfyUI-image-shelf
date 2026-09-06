import { isEqual } from "lodash-es"
import {
  CircleAlertIcon,
  FolderIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwClockIcon,
  Settings2Icon,
  SettingsIcon,
  StarIcon,
  TrashIcon,
} from "lucide-react"
import { useEffect, useState } from "react"

import { app } from "../../comfy"
import { FAVORITES_SETTING } from "../../global"
import { i18n, useTranslation } from "../../i18n/i18n"
import { errorToast, formatError } from "../../lib/error"
import { readCustomTabs, saveCustomTabs, toStoredCustomTab } from "../../lib/tab"
import { cn } from "../../lib/utils"
import {
  GalleryMessage,
  GalleryTab,
  reindexTab as reindexTabApi,
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
import { useTabList } from "./api"

interface TabListProps {
  tabs?: GalleryTab[]
  selectedTabId?: string
  onTabSelect: (tabId: string) => void
  updateTabs: ReturnType<typeof useTabList>["mutate"]
}

export function TabList({ tabs, selectedTabId, onTabSelect, updateTabs }: TabListProps) {
  const t = useTranslation()
  const selectedTab = tabs?.find((tab) => tab.id === selectedTabId)

  const removeTab = async (tab: GalleryTab) => {
    const confirmed = await ask({
      title: i18n.gallery.removeTab,
      message: i18n.gallery.removeTabMessage({ name: tab.name }),
    })
    if (!confirmed) return
    saveCustomTabs((prevTabs) => prevTabs.filter((storedTab) => storedTab.id !== tab.id))
    if (tab.id === selectedTabId) {
      onTabSelect("outputs")
    }
  }

  const reindexTab = async (tab: GalleryTab) => {
    try {
      await reindexTabApi(tab.id)
      updateTabs((current) => current?.map((t) => (t.id === tab.id ? { ...t, indexing: true } : t)))
    } catch (error: unknown) {
      errorToast({
        title: t.gallery.reindexFailed,
        message: formatError(error),
      })
    }
  }

  useEffect(() => {
    const handleTabsUpdated = ({ tabs: updatedTabs }: GalleryMessage["tabsUpdated"]) => {
      updateTabs((currentTabs) =>
        updatedTabs.map((update) => {
          const existingTab = currentTabs?.find((tab) => tab.id === update.id)
          if (existingTab) {
            return {
              ...existingTab,
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
    const handleIndexStart = ({ tab }: GalleryMessage["indexStart"]) => {
      updateTabs((current) => current?.map((t) => (t.id === tab ? { ...t, indexing: true } : t)))
    }
    const handleIndexFinish = ({ tab, result, error }: GalleryMessage["indexFinish"]) => {
      updateTabs((current) =>
        current?.map((t) =>
          t.id === tab
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
    socket.on("tabsUpdated", handleTabsUpdated)
    socket.on("indexStart", handleIndexStart)
    socket.on("indexFinish", handleIndexFinish)
    return () => {
      socket.off("tabsUpdated", handleTabsUpdated)
      socket.off("indexStart", handleIndexStart)
      socket.off("indexFinish", handleIndexFinish)
    }
  }, [updateTabs])

  return (
    <div className="flex flex-col gap-1 p-4 border-t">
      {tabs?.map((tab) => (
        <div
          key={tab.id}
          className={cn("flex rounded-md", tab === selectedTab && "bg-(--chart-3)")}
        >
          <Button
            variant="flat"
            className={cn(
              "grow justify-start",
              tab === selectedTab && "hover:bg-(--chart-4) dark:hover:bg-(--chart-4)",
            )}
            onClick={() => onTabSelect(tab.id)}
          >
            {tab.id === "outputs" ? (
              <RotateCcwClockIcon data-icon="inline-start" />
            ) : tab.id === "favorites" ? (
              <StarIcon data-icon="inline-start" />
            ) : (
              <FolderIcon data-icon="inline-start" />
            )}
            {tab.name}
            {tab.indexing ? (
              <LoaderCircleIcon data-icon="inline-end" className="animate-spin" />
            ) : (
              ` (${tab.count})`
            )}
            {tab.error && (
              <span title={formatError(tab.error)}>
                <CircleAlertIcon data-icon="inline-end" className="text-destructive" />
              </span>
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="flat"
                className={cn(
                  tab === selectedTab && "hover:bg-(--chart-4) dark:hover:bg-(--chart-4)",
                )}
              >
                <SettingsIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => void reindexTab(tab)}>
                  <RefreshCwIcon />
                  {t.gallery.reindex}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!tab.editable} onSelect={() => editTab(tab)}>
                  <Settings2Icon />
                  {t.gallery.editTab}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!tab.removable}
                  onSelect={async () => void removeTab(tab)}
                >
                  <TrashIcon />
                  {t.gallery.removeTab}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
      <Button className="grow justify-start" onClick={() => void addCustomTab()} variant="flat">
        <PlusIcon data-icon="inline-start" />
        {t.gallery.addTab}
      </Button>
    </div>
  )
}

const addCustomTab = async () => {
  const result = await askCreateTab({})
  if (!result) return
  saveCustomTabs((prevTabs) => [...prevTabs, toStoredCustomTab(result.tab)])
}

export async function editTab(tab: GalleryTab) {
  if (tab.id === "favorites") {
    // read the favorites folder from settings as the source of truth,
    // in case the tab info is somehow out of sync
    const favoriteSetting = app.extensionManager.setting.get(FAVORITES_SETTING)
    const currentFavoritesFolder = typeof favoriteSetting === "string" ? favoriteSetting : ""
    const result = await askEditTab({}, { ...tab, folders: [currentFavoritesFolder] })
    const newFolder = result?.tab.folders[0]?.trim()
    if (!newFolder || newFolder === currentFavoritesFolder) return
    app.extensionManager.setting.set(FAVORITES_SETTING, newFolder)
  } else {
    const result = await askEditTab({}, tab)
    if (!result) return
    const storedTabs = readCustomTabs()
    const storedTab = storedTabs.find((storedTab) => storedTab.id === tab.id)
    if (!storedTab) {
      console.warn(
        "[Image Shelf] editTab: stored tab not found",
        tab.id,
        storedTabs.map((t) => t.id),
      )
      return
    }
    const newTab = { ...storedTab, ...toStoredCustomTab(result.tab) }
    if (isEqual(storedTab, newTab)) return
    saveCustomTabs(storedTabs.map((t) => (t.id === storedTab.id ? newTab : t)))
  }
}

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
                <span className="ml-2 text-sm italic text-muted-foreground">
                  ({t.gallery.cannotEdit})
                </span>
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
