import type { Settings } from "@comfyorg/comfyui-frontend-types"

import "./driver/comfy-driver"

import React from "react"
import ReactDOM from "react-dom/client"

import { AskProvider } from "./components/ask"
import { GalleryControl } from "./components/gallery/Gallery"
import { TooltipProvider } from "./components/ui/tooltip"
import { getDriver } from "./driver/driver"
import { CUSTOM_TABS_SETTING, EXTENSION_ID, FAVORITES_SETTING } from "./global"
import { I18NProvider } from "./i18n/I18NProvider"
import "./index.css"
import { rootContainer } from "./lib/dom"
import { updateSettings } from "./services/gallery"

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
      settings: [
        {
          id: "image-shelf.favorites-folder" as keyof Settings,
          name: "Favorites folder",
          type: "text",
          defaultValue: "",
          category: ["Image Shelf", "Storage", "Favorites folder"],
          onChange: (value) => updateSettings({ [FAVORITES_SETTING]: value }),
        },
        {
          id: "image-shelf.custom-tabs" as keyof Settings,
          name: "Custom tabs",
          type: "hidden",
          defaultValue: [],
          onChange: (value) => updateSettings({ [CUSTOM_TABS_SETTING]: value }),
        },
      ],
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

function main() {
  loadStylesheet()
  mountUI()
  registerExtension()
}

main()
