import type { ComfyApp } from "@comfyorg/comfyui-frontend-types"

import { LGraphNode } from "../comfy-shims"
import { askConflictFilenames } from "../components/shared/transfer"
import { getDriver } from "../driver/driver"
import { i18n } from "../i18n/i18n"
import { errorToast, formatError } from "../lib/error"
import { getSettings } from "../lib/settings"
import { toast } from "../lib/toast"
import { AssetTransferItem, transferAssets, TransferConflictsError } from "../services/gallery"

export const NODE_TYPE_SEND_TO_FOLDER = "ImageShelfSendToFolder"

const INPUT_NAME_FOLDER = "folder"
const INPUT_NAME_SEND_MODE = "send_mode"
const INPUT_NAME_CONFLICT_MODE = "conflict_mode"
const INPUT_NAME_IMAGES = "images"

const app = getDriver().getComfyApp()

export function setupSendToFolderNode(node: LGraphNode) {
  const folderSlot = node.inputs.find((input) => input.name === INPUT_NAME_FOLDER)
  const folderWidget = folderSlot && node.getWidgetFromSlot(folderSlot)
  if (folderWidget) {
    folderWidget.options.getOptionLabel = (option) => {
      if (!option) return "-"
      return (
        getSettings().custom_folders?.find((folder) => folder.id === option)?.name ??
        i18n.common.unknownValue({ value: option })
      )
    }
  }

  const button = node.addWidget(
    "button",
    i18n.node.sendToFolder.send,
    "",
    async () => {
      try {
        await sendImages(node)
      } catch (e) {
        errorToast({
          title: i18n.node.sendToFolder.name,
          message: formatError(e),
        })
      }
    },
    { serialize: false },
  )
  button.serialize = false
}

async function sendImages(node: LGraphNode) {
  const inputNode = getInputNode(node, INPUT_NAME_IMAGES, app)
  if (!inputNode) {
    throw new Error(i18n.node.sendToFolder.noInputNode)
  }

  const outputs = app.nodeOutputs[inputNode.id]
  if (!outputs) {
    throw new Error(i18n.node.sendToFolder.noNodeOutput)
  }
  if (!outputs.images?.length) {
    throw new Error(i18n.node.sendToFolder.noNodeOutputImages)
  }
  const assetItems = outputs.images.filter(
    (image): image is typeof image & { filename: string } => typeof image.filename === "string",
  )
  if (assetItems.length !== outputs.images.length) {
    throw new Error(i18n.node.sendToFolder.noNodeOutputImages)
  }

  const folderId = node.widgets?.find((widget) => widget.name === INPUT_NAME_FOLDER)?.value
  if (!folderId || typeof folderId !== "string") {
    throw new Error(i18n.common.unknownValue({ value: `${INPUT_NAME_FOLDER}=${folderId}` }))
  }

  const sendMode = node.widgets?.find((widget) => widget.name === INPUT_NAME_SEND_MODE)?.value
  if (!sendMode || typeof sendMode !== "string") {
    throw new Error(i18n.common.unknownValue({ value: `${INPUT_NAME_SEND_MODE}=${sendMode}` }))
  }
  if (sendMode !== "copy" && sendMode !== "move") {
    throw new Error(i18n.common.unknownValue({ value: `${INPUT_NAME_SEND_MODE}=${sendMode}` }))
  }

  const conflictMode = node.widgets?.find(
    (widget) => widget.name === INPUT_NAME_CONFLICT_MODE,
  )?.value
  if (!conflictMode || typeof conflictMode !== "string") {
    throw new Error(
      i18n.common.unknownValue({ value: `${INPUT_NAME_CONFLICT_MODE}=${conflictMode}` }),
    )
  }
  if (conflictMode !== "ask" && conflictMode !== "rename") {
    throw new Error(
      i18n.common.unknownValue({ value: `${INPUT_NAME_CONFLICT_MODE}=${conflictMode}` }),
    )
  }

  await transferNodeAssets(assetItems, folderId, sendMode, conflictMode)
}

async function transferNodeAssets(
  assetItems: AssetTransferItem[],
  folderId: string,
  sendMode: "copy" | "move",
  conflictMode: "ask" | "rename",
  filenames?: Record<string, string>,
): Promise<void> {
  try {
    await transferAssets(
      assetItems,
      folderId,
      sendMode,
      conflictMode === "ask" ? "suggest" : "rename",
      filenames,
    )

    const folderName = getSettings().custom_folders?.find((folder) => folder.id === folderId)?.name
    toast({
      type: "success",
      title: i18n.node.sendToFolder.name,
      message:
        sendMode === "copy"
          ? i18n.transfer.copied({
              count: assetItems.length,
              folder: folderName ?? folderId,
            })
          : i18n.transfer.moved({
              count: assetItems.length,
              folder: folderName ?? folderId,
            }),
    })
  } catch (e) {
    if (e instanceof TransferConflictsError) {
      const answer = await askConflictFilenames(e.conflicts, assetItems.length)
      if (!answer) return

      const newFilenames = { ...filenames }
      for (const [conflict, filename] of answer.replacements) {
        if ("index" in conflict) {
          newFilenames[String(conflict.index)] = filename
        }
      }

      return transferNodeAssets(assetItems, folderId, sendMode, conflictMode, newFilenames)
    }
    throw e
  }
}

function getInputNode(node: LGraphNode, name: string, app: ComfyApp): LGraphNode | null {
  const linkId = node.inputs.find((input) => input.name === name)?.link
  if (linkId) {
    const link = app.rootGraph.getLink(linkId)
    if (link) {
      return app.rootGraph.getNodeById(link.origin_id) as LGraphNode | null
    }
  }
  return null
}
