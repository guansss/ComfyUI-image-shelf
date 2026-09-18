import "./driver/comfy-driver"
// This comment prevents the above import from being messed up by formatters
import React from "react"
import ReactDOM from "react-dom/client"

import { AskProvider } from "./components/ask"
import { GalleryControl } from "./components/gallery/Gallery"
import { TooltipProvider } from "./components/ui/tooltip"
import { getDriver } from "./driver/driver"
import { EXTENSION_ID } from "./global"
import { I18NProvider } from "./i18n/I18NProvider"
import "./index.css"
import { rootContainer } from "./lib/dom"
import { formatError } from "./lib/error"
import { initializeSettings } from "./lib/settings"

const OPEN_EVENT = "image-shelf:open"

function mountUI(): void {
  ReactDOM.createRoot(rootContainer).render(
    <React.StrictMode>
      <I18NProvider>
        <TooltipProvider>
          <GalleryControl openEvent={OPEN_EVENT} />
        </TooltipProvider>
        <AskProvider />
      </I18NProvider>
    </React.StrictMode>,
  )
}

function registerExtension(): void {
  getDriver()
    .getComfyApp()
    .registerExtension({
      name: "ComfyUI.ImageShelf",
      commands: [
        {
          id: "imageShelf.openGallery",
          label: "Open Image Shelf",
          function: () => {
            window.dispatchEvent(new Event(OPEN_EVENT))
          },
        },
      ],
      setup: (app) => {
        console.log("ComfyUI.ImageShelf extension setup")
        const openGalleryButton = new window.comfyAPI!.button.ComfyButton({
          icon: "image-search",
          classList: "primary",
          content: "Gallery",
          tooltip: "(Image Shelf) Open image gallery",
          action: () => {
            window.dispatchEvent(new Event(OPEN_EVENT))
          },
        })
        app.menu.settingsGroup.append(openGalleryButton)
      },
    })
}

function loadStylesheet(): void {
  const link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = `extensions/${EXTENSION_ID}/main.css`
  document.head.appendChild(link)
}

async function main() {
  try {
    await initializeSettings()
    loadStylesheet()
    mountUI()
    registerExtension()
  } catch (err) {
    console.error("[Image Shelf] Failed to initialize", err)
    getDriver().toast({
      type: "error",
      title: "[Image Shelf] Failed to initialize",
      message: formatError(err),
    })
  }
}

void main()
