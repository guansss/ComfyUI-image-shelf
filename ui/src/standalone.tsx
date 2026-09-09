import React from "react"

import "./driver/standalone-driver"

import ReactDOM from "react-dom/client"

import bgUrl from "../../tests/assets/a1111.jpg?url"
import { AskProvider } from "./components/ask"
import { GalleryControl } from "./components/gallery/Gallery"
import { Button } from "./components/ui/button"
import { Toaster } from "./components/ui/sonner"
import { TooltipProvider } from "./components/ui/tooltip"
import { getDriver } from "./driver/driver"
import { I18NProvider } from "./i18n/I18NProvider"
import { rootContainer } from "./lib/dom"
import { fetchSettings, updateSettings } from "./services/gallery"

const OPEN_EVENT = "image-shelf:open"

function mountUI() {
  ReactDOM.createRoot(rootContainer).render(
    <React.StrictMode>
      <I18NProvider>
        <div
          className="min-h-[150vh] bg-cover bg-center"
          style={{ backgroundImage: `url("${bgUrl}")` }}
        >
          <Button onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}>
            Open Image Shelf
          </Button>
          <TooltipProvider>
            <GalleryControl openEvent={OPEN_EVENT} />
          </TooltipProvider>
          <AskProvider />
          <Toaster />
        </div>
      </I18NProvider>
    </React.StrictMode>,
  )
}

async function main() {
  const settings = await fetchSettings()
  Object.entries(settings).forEach(([key, value]) => getDriver().setSetting(key, value))
  getDriver().addSettingsListener(({ key, value }) => void updateSettings({ [key]: value }))
  mountUI()
}

void main()
