import React from "react"
import ReactDOM from "react-dom/client"

import { app } from "./comfy"
import { Gallery } from "./components/gallery/Gallery"
import { TooltipProvider } from "./components/ui/tooltip"
import { EXTENSION_ID, rootContainer } from "./global"
import { I18NProvider } from "./i18n/I18NProvider"
import "./index.css"

const OPEN_EVENT = "image-shelf:open"
const DEBUG_EVENT = "image-shelf:debug-changed"
const COMFY_API_ROOT = "/api/image-shelf/v1"
const STANDALONE_API_ROOT = "http://127.0.0.1:8189/api/image-shelf/v1"
const FAVORITES_SETTING = "image-shelf.favorites-folder"
const CUSTOM_TABS_SETTING = "image-shelf.custom-tabs"

function mountUI(): void {
  ReactDOM.createRoot(rootContainer).render(
    <React.StrictMode>
      <I18NProvider>
        <TooltipProvider>
          <Gallery openEvent={OPEN_EVENT} />
        </TooltipProvider>
      </I18NProvider>
    </React.StrictMode>,
  )
}

function registerExtension(): void {
  const synchronizeBackend = (useStandaloneBackend = false) => {
    const apiRoot =
      import.meta.env.DEV && useStandaloneBackend ? STANDALONE_API_ROOT : COMFY_API_ROOT
    if (import.meta.env.DEV && useStandaloneBackend) {
      void fetch(`${apiRoot}/settings/reload`, { method: "POST" }).catch(() => undefined)
      return
    }
    const settings = {
      [FAVORITES_SETTING]: app.extensionManager.setting.get(FAVORITES_SETTING),
      [CUSTOM_TABS_SETTING]: app.extensionManager.setting.get(CUSTOM_TABS_SETTING),
    }
    void fetch(`${apiRoot}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }).catch(() => undefined)
  }

  app.registerExtension({
    name: "ComfyUI.ImageShelf",
    settings: [
      {
        id: "image-shelf.favorites-folder",
        name: "Favorites folder",
        type: "text",
        defaultValue: "",
        category: ["Image Shelf", "Storage", "Favorites folder"],
        onChange: () => synchronizeBackend(),
      },
      {
        id: "image-shelf.custom-tabs",
        name: "Custom tabs",
        type: "hidden",
        defaultValue: "[]",
        onChange: () => synchronizeBackend(),
      },
      {
        id: "image-shelf.last-gallery-state",
        name: "Last gallery state",
        type: "hidden",
        defaultValue: "{}",
      },
      ...(import.meta.env.DEV
        ? [
            {
              id: "image-shelf.debug-standalone",
              name: "Use standalone backend",
              type: "boolean" as const,
              defaultValue: false,
              category: ["Image Shelf", "Development", "Use standalone backend"],
              onChange: (value: boolean) => {
                window.dispatchEvent(new CustomEvent<boolean>(DEBUG_EVENT, { detail: value }))
                synchronizeBackend(value)
              },
            },
          ]
        : []),
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
