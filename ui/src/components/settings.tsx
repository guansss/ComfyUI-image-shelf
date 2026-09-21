import { useAtom, useAtomValue } from "jotai"
import { useEffect, useState } from "react"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { allEssentials, languageAtom, languages, useTranslation } from "../i18n/i18n"
import { configAtom } from "../lib/config"
import { rootContainer } from "../lib/dom"
import { formatFileSize } from "../lib/utils"
import { fetchAppInfo, type AppInfo } from "../services/gallery"
import { Field, FieldGroup, FieldLabel, FieldLegend } from "./ui/field"
import { ScrollArea } from "./ui/scroll-area"

const languageOptions = languages
  .map((lang) => ({
    title: allEssentials[lang].language,
    value: lang,
  }))
  .sort((a, b) => a.title.localeCompare(b.title))

export function ThemeSync() {
  const theme = useAtomValue(configAtom).theme

  useEffect(() => {
    rootContainer.classList.toggle("dark", theme === "dark")
  }, [theme])

  return null
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslation()
  const [language, setLanguage] = useAtom(languageAtom)
  const [config, setConfig] = useAtom(configAtom)
  const [appInfo, setAppInfo] = useState<AppInfo>()

  useEffect(() => {
    if (!open) return

    let active = true
    fetchAppInfo()
      .then((info) => {
        if (active) setAppInfo(info)
      })
      .catch(() => {
        if (active) setAppInfo(undefined)
      })

    return () => {
      active = false
    }
  }, [open])

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="w-96 gap-4">
        <DialogHeader>
          <DialogTitle>{t.settings.title}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[80vh]">
          <div className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="settings-language">{t.settings.language}</FieldLabel>
                <Select
                  value={language}
                  onValueChange={(value) => setLanguage(value as (typeof languages)[number])}
                >
                  <SelectTrigger id="settings-language" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {languageOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.title}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-theme">{t.settings.theme}</FieldLabel>
                <Select
                  value={config.theme}
                  onValueChange={(value) => setConfig({ theme: value as typeof config.theme })}
                >
                  <SelectTrigger id="settings-theme" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="light">{t.settings.light}</SelectItem>
                      <SelectItem value="dark">{t.settings.dark}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            {appInfo && (
              <section className="flex flex-col gap-2 border-t pt-4 text-sm">
                <FieldLegend>{t.settings.appInfo}</FieldLegend>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{t.settings.databasePath}</span>
                  <span className="break-all text-muted-foreground">{appInfo.database_path}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{t.settings.databaseSize}</span>
                  <span className="text-muted-foreground">
                    {formatFileSize(appInfo.database_size)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{t.settings.settingsPath}</span>
                  <span className="break-all text-muted-foreground">{appInfo.settings_path}</span>
                </div>
              </section>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
