import { isBoolean } from "lodash-es"
import { AlertCircleIcon, CircleQuestionMarkIcon, LoaderCircleIcon, SearchIcon } from "lucide-react"
import { useState } from "react"
import { useDebounce } from "react-use"

import { useTranslation } from "../../i18n/i18n"
import { formatError } from "../../lib/error"
import { parseSearchValue, queryToString, SearchQuery, SearchTerm } from "../../lib/search"
import { cn } from "../../lib/utils"
import { TagSuggestion } from "../../services/gallery"
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteStatus,
} from "../reui/autocomplete"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { InputGroup, InputGroupAddon } from "../ui/input-group"
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "../ui/popover"
import { Table, TableBody, TableCell, TableRow } from "../ui/table"
import { useTagSuggestions } from "./api"

export { parseSearchValue } from "../../lib/search"

interface SearchbarProps {
  loading?: boolean
  query: SearchQuery
  onQueryChange: (query: SearchQuery) => void
  onSubmit?: () => void
}

const TERM_COLORS = {
  tag: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  negativeTag: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  filename: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  prompt: "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  invalid: "",
} satisfies Record<SearchTerm["type"], string>

export function Searchbar({ loading, query, onQueryChange, onSubmit }: SearchbarProps) {
  const t = useTranslation()
  const [text, setText] = useState(queryToString(query))
  const [cursorIndex, setCursorIndex] = useState(text.length)

  useDebounce(() => onQueryChange(parseSearchValue(text, cursorIndex)), 100, [text, cursorIndex])

  const { data: tagSuggestions, error: tagSuggestionsError } = useTagSuggestions({
    query: query.activeTerm?.value,
  })

  const applyTagSuggestion = (suggestion: TagSuggestion) => {
    const term = {
      type: suggestion.type === "negative" ? "negativeTag" : "tag",
      value: suggestion.name,
      quoted: suggestion.name.includes(" "),
      prefix: "tag:",
      exclude: false as boolean,
    } satisfies SearchTerm
    const activeTerm = query.activeTerm
    if (activeTerm) {
      if ("exclude" in activeTerm && isBoolean(activeTerm.exclude)) {
        term.exclude = activeTerm.exclude
      }
      const newTerms = query.terms.map((t) => (t === activeTerm ? term : t))
      return queryToString({ ...query, terms: newTerms })
    } else {
      const newTerms = [...query.terms, term]
      return queryToString({ ...query, terms: newTerms })
    }
  }

  const handleKeyUp = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      onSubmit?.()
    }
  }

  const handleChange = (newValue: string) => {
    setText(newValue)
    setCursorIndex(newValue.length)
  }

  const shouldRenderPopup =
    query.activeTerm?.type === "tag" || query.activeTerm?.type === "negativeTag"

  return (
    <div className="flex-1 flex flex-col gap-2">
      <InputGroup>
        <Autocomplete
          items={tagSuggestions}
          value={text}
          onValueChange={handleChange}
          itemToStringValue={applyTagSuggestion}
          mode="none"
          filter={null}
        >
          <AutocompleteInput
            showClear
            className="flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            placeholder={t.search.placeholder}
            onSelect={(event) => setCursorIndex(event.currentTarget.selectionEnd ?? text.length)}
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
                {tagSuggestionsError ? (
                  <div className="flex items-center gap-2">
                    <AlertCircleIcon className="size-4" />
                    {formatError(tagSuggestionsError)}
                  </div>
                ) : tagSuggestions?.length === 0 ? (
                  <div className="text-sm text-muted-foreground">{t.search.noSuggestions}</div>
                ) : null}
              </AutocompleteStatus>
            </AutocompleteContent>
          )}
        </Autocomplete>

        <InputGroupAddon>
          {loading ? <LoaderCircleIcon className="animate-spin" /> : <SearchIcon />}
        </InputGroupAddon>
      </InputGroup>
      <div className="flex flex-wrap gap-1 min-h-6">
        {query.terms.length ? (
          query.terms
            .filter((term) => !("invalid" in term && term.invalid))
            .map((term, index) => (
              <Badge
                key={index}
                className={cn(
                  "cursor-default",
                  TERM_COLORS[term.type],
                  "exclude" in term && term.exclude ? "line-through" : "",
                )}
              >
                {term.prefix}
                {term.value}
              </Badge>
            ))
        ) : (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="flat" size="xs" className="opacity-70" title={t.search.searchHelp}>
                <CircleQuestionMarkIcon data-icon="inline-start" />
                {t.search.example}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto max-w-screen">
              <PopoverHeader>
                <PopoverTitle>{t.search.searchHelp}</PopoverTitle>
              </PopoverHeader>
              <p className="text-sm wrap-break-word">{t.search.searchNote}</p>
              <Table>
                <TableBody>
                  {Object.entries(t.search.syntaxTable).map(([term, desc]) => (
                    <TableRow key={term}>
                      <TableCell>{term}</TableCell>
                      <TableCell>{desc}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  )
}
