import { useAtom, useAtomValue } from "jotai"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
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
import { settingsAtom } from "../lib/settings"
import { formatFileSize } from "../lib/utils"
import { clearThumbnailCache, fetchAppInfo, type AppInfo } from "../services/gallery"
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet } from "./ui/field"
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
  const [, setSettings] = useAtom(settingsAtom)
  const [appInfo, setAppInfo] = useState<AppInfo>()
  const [cacheLimit, setCacheLimit] = useState("")
  const [isClearingCache, setIsClearingCache] = useState(false)
  const [cacheMessage, setCacheMessage] = useState<string>()

  useEffect(() => {
    if (!open) return

    let active = true
    fetchAppInfo()
      .then((info) => {
        if (active) {
          setAppInfo(info)
          setCacheLimit(String(info.thumbnail_cache.max_bytes))
        }
      })
      .catch(() => {
        if (active) setAppInfo(undefined)
      })

    return () => {
      active = false
    }
  }, [open])

  const saveCacheLimit = () => {
    const value = Number(cacheLimit)
    if (!Number.isInteger(value) || value <= 0) return
    void setSettings({ thumbnail_cache_max_bytes: value })
  }

  const handleClearCache = async () => {
    setIsClearingCache(true)
    setCacheMessage(undefined)
    try {
      await clearThumbnailCache()
      setCacheMessage(t.settings.cacheCleared)
      const info = await fetchAppInfo()
      setAppInfo(info)
      setCacheLimit(String(info.thumbnail_cache.max_bytes))
    } catch {
      setCacheMessage(t.settings.clearCacheFailed)
    } finally {
      setIsClearingCache(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="w-100 gap-4">
        <DialogHeader>
          <DialogTitle>{t.settings.title}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[80vh]">
          <div className="flex flex-col gap-4">
            <FieldSet>
              <FieldLegend>{t.settings.ui}</FieldLegend>
              <FieldGroup>
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="settings-language">{t.settings.language}</FieldLabel>
                  <Select
                    value={language}
                    onValueChange={(value) => setLanguage(value as (typeof languages)[number])}
                  >
                    <SelectTrigger id="settings-language" className="min-w-40 shrink">
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
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="settings-theme">{t.settings.theme}</FieldLabel>
                  <Select
                    value={config.theme}
                    onValueChange={(value) => setConfig({ theme: value as typeof config.theme })}
                  >
                    <SelectTrigger id="settings-theme" className="min-w-40 shrink">
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
            </FieldSet>
            <FieldSeparator />
            {appInfo && (
              <section className="flex flex-col gap-2 pt-4 text-sm">
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
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{t.settings.thumbnailCache}</span>
                  <span className="text-muted-foreground">
                    {t.settings.cacheSize}: {formatFileSize(appInfo.thumbnail_cache.bytes)}
                  </span>
                  <span className="text-muted-foreground">
                    {t.settings.cacheFiles}: {appInfo.thumbnail_cache.files}
                  </span>
                  <label className="flex flex-col gap-1" htmlFor="settings-cache-limit">
                    <span>{t.settings.cacheLimit}</span>
                    <Input
                      id="settings-cache-limit"
                      min={1}
                      onBlur={saveCacheLimit}
                      onChange={(event) => setCacheLimit(event.target.value)}
                      type="number"
                      value={cacheLimit}
                    />
                  </label>
                  <Button disabled={isClearingCache} onClick={handleClearCache} type="button">
                    {t.settings.clearCache}
                  </Button>
                  {cacheMessage && <span className="text-muted-foreground">{cacheMessage}</span>}
                </div>
              </section>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
