import { fetchTagSuggestions, GalleryTab, TagSuggestion } from "../../galleryApi"
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteStatus,
} from "../reui/autocomplete"
import { InputGroup, InputGroupAddon, InputGroupButton } from "../ui/input-group"
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "../ui/popover"
import { debounce } from "lodash-es"
import { CircleQuestionMarkIcon, LoaderCircleIcon, SearchIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

interface SearchbarProps {
  apiRoot: string
  tab?: GalleryTab
  value: string
  onChange: (value: string) => void
  placeholder?: string
  onSubmit?: () => void
}

export function Searchbar({ apiRoot, tab, value, onChange, onSubmit }: SearchbarProps) {
  const { t } = useTranslation()
  const suggestionsAbortControllerRef = useRef<AbortController | null>(null)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([])

  const updateSuggestions = useMemo(
    () =>
      debounce((searchValue) => {
        if (suggestionsAbortControllerRef.current) {
          suggestionsAbortControllerRef.current.abort()
        }
        if (!searchValue || !tab) {
          setTagSuggestions([])
          return
        }
        setSuggestionsLoading(true)
        const controller = new AbortController()
        suggestionsAbortControllerRef.current = controller
        void fetchTagSuggestions(tab.id, searchValue, apiRoot, controller.signal)
          .then(setTagSuggestions)
          .catch((error: unknown) => {
            if (!(error instanceof DOMException && error.name === "AbortError")) {
              setTagSuggestions([])
            }
          })
          .finally(() => setSuggestionsLoading(false))
      }),
    [tab, apiRoot],
  )

  useEffect(() => {
    const terms = value.trim().split(/\s+/)
    const term = terms[terms.length - 1] ?? ""
    const searchValue = term.replace(/^-?tag:/, "").replace(/^-/, "")
    updateSuggestions(searchValue)
  }, [value, updateSuggestions])

  const selectTagSuggestion = (suggestion: TagSuggestion) => {
    const terms = value.trim().split(/\s+/)
    const activeTerm = terms[terms.length - 1] ?? ""
    const prefix = activeTerm.startsWith("-tag:")
      ? "-tag:"
      : activeTerm.startsWith("tag:-") || suggestion.type === "negative"
        ? "tag:-"
        : "tag:"
    terms[terms.length - 1] =
      prefix + (suggestion.name.includes(" ") ? `"${suggestion.name}"` : suggestion.name)
    return terms.join(" ").trim()
  }

  const handleKeyUp = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      onSubmit?.()
    }
  }

  const shouldRenderPopup = !!value.trim()

  return (
    <>
      <InputGroup>
        <Autocomplete
          items={tagSuggestions}
          value={value}
          onValueChange={onChange}
          itemToStringValue={selectTagSuggestion}
          mode="both"
          filter={null}
        >
          <AutocompleteInput
            showClear
            className="flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            placeholder={t("gallery.search")}
            onKeyUp={handleKeyUp}
          />
          {shouldRenderPopup && (
            <AutocompleteContent>
              <AutocompleteList>
                {(suggestion: TagSuggestion) => (
                  <AutocompleteItem
                    key={suggestion.type + suggestion.name}
                    value={suggestion}
                    className="rounded-lg"
                  >
                    {`tag:${suggestion.type === "negative" ? "-" : ""}${suggestion.name}`}
                  </AutocompleteItem>
                )}
              </AutocompleteList>
              <AutocompleteStatus>
                {suggestionsLoading ? (
                  <div className="flex items-center gap-2">
                    <LoaderCircleIcon className="size-4 animate-spin" />
                    {t("gallery.loading")}
                  </div>
                ) : tagSuggestions.length === 0 ? (
                  <div className="text-sm text-muted-foreground">{t("gallery.noSuggestions")}</div>
                ) : null}
              </AutocompleteStatus>
            </AutocompleteContent>
          )}
        </Autocomplete>

        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <Popover>
          <PopoverTrigger asChild>
            <InputGroupAddon align="inline-end">
              <InputGroupButton variant="secondary" size="icon-xs">
                <CircleQuestionMarkIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </PopoverTrigger>
          <PopoverContent className="w-150 max-w-screen">
            <PopoverHeader>
              <PopoverTitle>{t("gallery.searchHelp")}</PopoverTitle>
            </PopoverHeader>
            <p className="text-sm wrap-break-word">{t("gallery.searchSyntax")}</p>
          </PopoverContent>
        </Popover>
      </InputGroup>
    </>
  )
}
