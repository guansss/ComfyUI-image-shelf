import type { ComfyApp } from "@comfyorg/comfyui-frontend-types"

import { LGraphNode } from "../comfy-shims"
import { getDriver } from "../driver/driver"
import { i18n } from "../i18n/i18n"
import { formatError } from "../lib/error"
import { getSettings } from "../lib/settings"
import { transferAssets } from "../services/gallery"

export const NODE_TYPE_SEND_TO_FOLDER = "ImageShelfSendToFolder"

const INPUT_NAME_FOLDER = "folder"
const INPUT_NAME_MODE = "send_mode"
const INPUT_NAME_IMAGES = "images"

export function setupSendToFolderNode(node: LGraphNode, app: ComfyApp) {
  const folderSlot = node.inputs.find((input) => input.name === INPUT_NAME_FOLDER)
  const folderWidget = node.getWidgetFromSlot(folderSlot!)
  folderWidget!.options.getOptionLabel = (option) => {
    if (!option) return "N/A"
    return (
      getSettings().custom_folders?.find((folder) => folder.id === option)?.name ??
      i18n.common.unknownValue({ value: option })
    )
  }
  const button = node.addWidget(
    "button",
    i18n.node.sendToFolder.send,
    "",
    () => void sendImages(node, app),
    { serialize: false },
  )
  button.serialize = false
}

async function sendImages(node: LGraphNode, app: ComfyApp) {
  const inputNode = getInputNode(node, INPUT_NAME_IMAGES, app)
  if (!inputNode) {
    getDriver().toast({
      type: "error",
      title: i18n.node.sendToFolder.name,
      message: i18n.node.sendToFolder.noInputNode,
    })
    return
  }

  const outputs = app.nodeOutputs[inputNode.id]
  if (!outputs) {
    getDriver().toast({
      type: "error",
      title: i18n.node.sendToFolder.name,
      message: i18n.node.sendToFolder.noNodeOutput,
    })
    return
  }
  if (!outputs.images?.length) {
    getDriver().toast({
      type: "error",
      title: i18n.node.sendToFolder.name,
      message: i18n.node.sendToFolder.noNodeOutputImages,
    })
    return
  }
  const assetItems = outputs.images.filter(
    (image): image is typeof image & { filename: string } => typeof image.filename === "string",
  )
  if (assetItems.length !== outputs.images.length) {
    getDriver().toast({
      type: "error",
      title: i18n.node.sendToFolder.name,
      message: i18n.node.sendToFolder.noNodeOutputImages,
    })
    return
  }

  const folderId = node.widgets?.find((widget) => widget.name === INPUT_NAME_FOLDER)?.value
  if (!folderId || typeof folderId !== "string") {
    getDriver().toast({
      type: "error",
      title: i18n.node.sendToFolder.name,
      message: i18n.common.unknownValue({ value: `${INPUT_NAME_FOLDER}=${folderId}` }),
    })
    return
  }

  const mode = node.widgets?.find((widget) => widget.name === INPUT_NAME_MODE)?.value
  if (!mode || typeof mode !== "string") {
    getDriver().toast({
      type: "error",
      title: i18n.node.sendToFolder.name,
      message: i18n.common.unknownValue({ value: `${INPUT_NAME_MODE}=${mode}` }),
    })
    return
  }
  if (mode !== "copy" && mode !== "move") {
    getDriver().toast({
      type: "error",
      title: i18n.node.sendToFolder.name,
      message: i18n.common.unknownValue({ value: `${INPUT_NAME_MODE}=${mode}` }),
    })
    return
  }

  try {
    await transferAssets(assetItems, folderId, mode)

    const folderName = getSettings().custom_folders?.find((folder) => folder.id === folderId)?.name
    getDriver().toast({
      type: "success",
      title: i18n.node.sendToFolder.name,
      message:
        mode === "copy"
          ? i18n.node.sendToFolder.copied({
              count: assetItems.length,
              folder: folderName ?? folderId,
            })
          : i18n.node.sendToFolder.moved({
              count: assetItems.length,
              folder: folderName ?? folderId,
            }),
    })
  } catch (e) {
    getDriver().toast({
      type: "error",
      title: i18n.node.sendToFolder.name,
      message: formatError(e),
    })
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
