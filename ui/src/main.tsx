import type { Settings } from "@comfyorg/comfyui-frontend-types"

import React from "react"
import ReactDOM from "react-dom/client"

import { app } from "./comfy"
import { AskProvider } from "./components/ask"
import { Gallery } from "./components/gallery/Gallery"
import { TooltipProvider } from "./components/ui/tooltip"
import { API_ROOT, EXTENSION_ID, rootContainer } from "./global"
import { I18NProvider } from "./i18n/I18NProvider"
import "./index.css"

const OPEN_EVENT = "image-shelf:open"
const FAVORITES_SETTING = "image-shelf.favorites-folder"
const CUSTOM_TABS_SETTING = "image-shelf.custom-tabs"

function mountUI(): void {
  ReactDOM.createRoot(rootContainer).render(
    <React.StrictMode>
      <I18NProvider>
        <TooltipProvider>
          <Gallery openEvent={OPEN_EVENT} />
        </TooltipProvider>
        <AskProvider />
      </I18NProvider>
    </React.StrictMode>,
  )
}

function registerExtension(): void {
  const updateBackendSettings = (patch: Record<string, unknown>) => {
    void fetch(`${API_ROOT}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => undefined)
  }

  app.registerExtension({
    name: "ComfyUI.ImageShelf",
    settings: [
      {
        id: "image-shelf.favorites-folder" as keyof Settings,
        name: "Favorites folder",
        type: "text",
        defaultValue: "",
        category: ["Image Shelf", "Storage", "Favorites folder"],
        onChange: (value) => updateBackendSettings({ [FAVORITES_SETTING]: value }),
      },
      {
        id: "image-shelf.custom-tabs" as keyof Settings,
        name: "Custom tabs",
        type: "hidden",
        defaultValue: [],
        onChange: (value) => updateBackendSettings({ [CUSTOM_TABS_SETTING]: value }),
      },
      {
        id: "image-shelf.last-gallery-state" as keyof Settings,
        name: "Last gallery state",
        type: "hidden",
        defaultValue: "{}",
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
      const openGalleryButton = new window.comfyAPI.button.ComfyButton({
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
