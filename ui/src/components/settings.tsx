import { useAtom, useAtomValue } from "jotai"
import { AlertCircleIcon, InfoIcon, MonitorIcon, TagsIcon, Trash2Icon } from "lucide-react"
import { useEffect, useState } from "react"
import useSWR from "swr"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { errorToast, formatError } from "../lib/error"
import { settingsAtom } from "../lib/settings"
import { toast } from "../lib/toast"
import { formatFileSize } from "../lib/utils"
import { clearThumbnailCache, fetchAppInfo } from "../services/gallery"
import { PopoverControl, usePopoverTrigger } from "../utils/react"
import { HintEditorDialog } from "./hint"
import { Alert, AlertDescription, AlertTitle } from "./ui/alert"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "./ui/input-group"
import { ScrollArea } from "./ui/scroll-area"
import { Separator } from "./ui/separator"
import { Spinner } from "./ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"

const languageOptions = languages
  .map((lang) => ({
    title: allEssentials[lang].language,
    value: lang,
  }))
  .sort((a, b) => a.title.localeCompare(b.title))

const BYTES_PER_MB = 1024 * 1024

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
  const [cacheLimit, setCacheLimit] = useState("")
  const [isSettingCacheLimit, setIsSettingCacheLimit] = useState(false)
  const [isClearingCache, setIsClearingCache] = useState(false)
  const hintEditorTrigger = usePopoverTrigger()

  const {
    data: appInfo,
    isLoading: appInfoLoading,
    error: appInfoError,
    mutate: mutateAppInfo,
  } = useSWR("appInfo", fetchAppInfo, {
    onSuccess: (data) => {
      setCacheLimit(String(data.thumbnail_cache.max_bytes / BYTES_PER_MB))
    },
  })

  const saveCacheLimit = async () => {
    const value = Number(cacheLimit)
    if (!Number.isInteger(value) || value <= 0) {
      if (appInfo) {
        setCacheLimit(String(appInfo.thumbnail_cache.max_bytes / BYTES_PER_MB))
      }
      return
    }
    try {
      setIsSettingCacheLimit(true)
      await setSettings({ thumbnail_cache_max_bytes: value * BYTES_PER_MB })
      toast({
        type: "success",
        title: t.settings.cacheLimitSaved,
      })
    } catch (e) {
      console.error(e)
      errorToast({
        title: t.settings.cacheLimit,
        message: formatError(e),
      })
    } finally {
      setIsSettingCacheLimit(false)
    }
  }

  const handleClearCache = async () => {
    setIsClearingCache(true)
    try {
      await clearThumbnailCache()
      mutateAppInfo()
      toast({
        type: "success",
        title: t.settings.cacheCleared,
      })
    } catch (e) {
      console.error(e)
      errorToast({
        title: t.settings.clearCacheFailed,
        message: formatError(e),
      })
    } finally {
      setIsClearingCache(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="w-120">
        <DialogHeader>
          <DialogTitle>{t.settings.title}</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="ui">
          <TabsList className="bg-current/10">
            <TabsTrigger value="ui">
              <MonitorIcon />
              {t.settings.ui}
            </TabsTrigger>
            <TabsTrigger value="metadata">
              <TagsIcon />
              {t.settings.metadata}
            </TabsTrigger>
            <TabsTrigger value="info">
              <InfoIcon />
              {t.settings.appInfo}
            </TabsTrigger>
          </TabsList>
          <Separator />
          <TabsContent value="ui" className="basis-auto h-100">
            <ScrollArea className="h-full">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="settings-language">{t.settings.language}</FieldLabel>
                  <Select
                    value={language}
                    onValueChange={(value) => setLanguage(value as (typeof languages)[number])}
                  >
                    <SelectTrigger id="settings-language" className="min-w-40">
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
                    <SelectTrigger id="settings-theme" className="min-w-40">
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
            </ScrollArea>
          </TabsContent>
          <TabsContent value="metadata" className="basis-auto h-100 flex flex-col">
            <ScrollArea className="grow min-h-0">
              <div className="flex flex-col gap-3 py-1">
                <Field>
                  <FieldLabel htmlFor="settings-prompt-hints">{t.settings.promptHints}</FieldLabel>
                  <FieldDescription>{t.settings.promptHintsDescription}</FieldDescription>
                </Field>
                <Button
                  className="self-start"
                  variant="outline"
                  onClick={() => hintEditorTrigger.toggle()}
                >
                  {t.common.edit}
                </Button>
                <PopoverControl trigger={hintEditorTrigger}>
                  {({ isOpen, setOpenState }) => (
                    <HintEditorDialog isOpen={isOpen} onOpenChange={setOpenState} />
                  )}
                </PopoverControl>
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="info" className="basis-auto h-100 flex flex-col">
            {appInfoLoading ? (
              <Spinner className="self-center my-auto size-10" />
            ) : !appInfo ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>{t.error.error}</AlertTitle>
                <AlertDescription>{formatError(appInfoError)}</AlertDescription>
              </Alert>
            ) : (
              <>
                <ScrollArea className="grow min-h-0">
                  <FieldGroup className="mb-4">
                    <Field>
                      <FieldLabel>{t.settings.settingsPath}</FieldLabel>
                      <span className="text-muted-foreground break-all">
                        {appInfo.settings_path}
                      </span>
                    </Field>
                    <Field>
                      <FieldLabel>{t.settings.databasePath}</FieldLabel>
                      <span className="text-muted-foreground break-all">
                        {appInfo.database_path}
                      </span>
                    </Field>
                    <Field>
                      <FieldLabel>{t.settings.databaseSize}</FieldLabel>
                      <span className="text-muted-foreground">
                        {formatFileSize(appInfo.database_size)}
                      </span>
                    </Field>
                    <Field>
                      <FieldLabel>{t.settings.cacheFiles}</FieldLabel>
                      <span className="text-muted-foreground">{appInfo.thumbnail_cache.files}</span>
                    </Field>
                    <Field>
                      <FieldLabel>{t.settings.cacheSize}</FieldLabel>
                      <span className="text-muted-foreground">
                        {formatFileSize(appInfo.thumbnail_cache.bytes)}
                      </span>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="settings-cache-limit">
                        {t.settings.cacheLimit}
                      </FieldLabel>
                      <InputGroup className="self-start w-auto!">
                        <InputGroupInput
                          id="settings-cache-limit"
                          min={1}
                          onBlur={saveCacheLimit}
                          onChange={(event) => setCacheLimit(event.target.value)}
                          type="number"
                          value={cacheLimit}
                          disabled={isSettingCacheLimit}
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>MB</InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                    </Field>
                  </FieldGroup>
                </ScrollArea>
                <DialogFooter>
                  <Button disabled={isClearingCache} onClick={handleClearCache} type="button">
                    {isClearingCache ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Trash2Icon data-icon="inline-start" />
                    )}
                    {t.settings.clearCache}
                  </Button>
                </DialogFooter>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
