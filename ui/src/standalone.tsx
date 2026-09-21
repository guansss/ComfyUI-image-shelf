import "./driver/standalone-driver"
// This comment prevents the above import from being messed up by formatters
import React from "react"
import ReactDOM from "react-dom/client"

import bgUrl from "../../tests/assets/a1111.jpg?url"
import { AskProvider } from "./components/ask"
import { GalleryControl } from "./components/gallery/Gallery"
import { ThemeSync } from "./components/settings"
import { Button } from "./components/ui/button"
import { Toaster } from "./components/ui/sonner"
import { TooltipProvider } from "./components/ui/tooltip"
import { I18NProvider } from "./i18n/I18NProvider"
import { rootContainer } from "./lib/dom"
import { initializeSettings } from "./lib/settings"

const OPEN_EVENT = "image-shelf:open"

function mountUI() {
  ReactDOM.createRoot(rootContainer).render(
    <React.StrictMode>
      <I18NProvider>
        <ThemeSync />
        <TooltipProvider>
          <GalleryControl openEvent={OPEN_EVENT} />
        </TooltipProvider>
        <AskProvider />
        <Toaster expand position="top-right" visibleToasts={10} />
        <div
          className="relative min-h-[150vh] bg-cover bg-center"
          style={{ backgroundImage: `url("${bgUrl}")` }}
        >
          <div className="absolute inset-0 bg-black/50 pointer-events-none" />
          <Button className="absolute" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}>
            Open Image Shelf
          </Button>
        </div>
      </I18NProvider>
    </React.StrictMode>,
  )
}

async function main() {
  await initializeSettings()
  mountUI()
}

void main()
