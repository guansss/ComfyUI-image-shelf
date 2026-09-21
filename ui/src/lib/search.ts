export interface SearchQuery {
  activeTerm?: SearchTerm
  terms: SearchTerm[]
}

export type SearchTerm = {
  value: string
  quoted: boolean
  prefix: "" | "tag:" | "name:" | "info:"
} & (
  | { type: "tag"; exclude: boolean }
  | { type: "negativeTag"; exclude: boolean }
  | { type: "filename" }
  | { type: "info" }
  | { type: "invalid" }
)

export function emptyQuery(): SearchQuery {
  return { terms: [] }
}

// See tests for syntax examples.
export function parseSearchValue(value: string, cursorIndex: number): SearchQuery {
  const terms: SearchTerm[] = []
  let index = 0
  let activeTerm: SearchTerm | undefined

  while (index < value.length) {
    if (/\s/.test(value[index])) {
      index++
      continue
    }

    const startIndex = index
    let endIndex = index
    while (endIndex < value.length && !/\s/.test(value[endIndex])) endIndex++

    const firstToken = value.slice(startIndex, endIndex)
    const prefixMatch = firstToken.match(/^-?(?:tag:|name:|info:)/)
    const quoteIndex = firstToken.indexOf('"')

    if ((prefixMatch || firstToken.startsWith('"')) && quoteIndex !== -1 && !firstToken.slice(quoteIndex + 1).includes('"')) {
      const closingQuote = value.indexOf('"', endIndex)
      const closingQuoteEndsTerm =
        closingQuote === value.length - 1 || (closingQuote !== -1 && /\s/.test(value[closingQuote + 1]))
      if (closingQuote !== -1 && (prefixMatch || closingQuoteEndsTerm)) {
        endIndex = closingQuote + 1
        while (endIndex < value.length && !/\s/.test(value[endIndex])) endIndex++
      }
    }

    const rawTerm = value.slice(startIndex, endIndex)
    const term = parseTerm(rawTerm)
    terms.push(term)
    if (cursorIndex >= startIndex && cursorIndex <= endIndex) {
      activeTerm = term
    }
    index = endIndex
  }

  return {
    terms,
    activeTerm,
  }
}

function parseTerm(rawTerm: string): SearchTerm {
  const invalid = (): SearchTerm => ({
    type: "invalid",
    value: rawTerm,
    quoted: false,
    prefix: "",
  })

  let token = rawTerm
  let exclude = false
  if (token.startsWith("-")) {
    exclude = true
    token = token.slice(1)
  }

  let type: SearchTerm["type"] = "tag"
  let value = token
  let prefix = ""
  if (token.startsWith("tag:")) prefix = "tag:"
  else if (token.startsWith("name:")) {
    prefix = "name:"
    type = "filename"
  } else if (token.startsWith("info:")) {
    prefix = "info:"
    type = "info"
  } else if (token.includes(":")) return invalid()

  if (prefix) value = token.slice(prefix.length)
  if (type === "tag" && value.startsWith("-")) {
    type = "negativeTag"
    value = value.slice(1)
  }

  const quoted = value.startsWith('"') || value.endsWith('"')
  if (quoted) {
    if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) return invalid()
    value = value.slice(1, -1)
  }
  if (!value || value.includes('"')) return invalid()

  return {
    type,
    value,
    quoted,
    prefix,
    ...(type === "tag" || type === "negativeTag" ? { exclude } : {}),
  } as SearchTerm
}

export function queryToString(parsedQuery: SearchQuery): string {
  return parsedQuery.terms.map((term) => termToString(term)).join(" ")
}

function termToString(term: SearchTerm): string {
  if (term.type === "invalid") return term.value

  const value = term.quoted ? `"${term.value}"` : term.value
  if (term.type === "negativeTag") {
    return `${term.exclude ? "-" : ""}${term.prefix}-${value}`
  }
  if (term.type === "tag") {
    return `${term.exclude ? "-" : ""}${term.prefix}${value}`
  }
  return `${term.prefix}${value}`
}

export type BackendSearchTerm = {
  field: "name" | "info" | "tag"
  value: string
  excluded: boolean
  tag_type: "negative" | "positive"
}

export function toBackendSearchTerms(terms: SearchTerm[]): BackendSearchTerm[] {
  const searchTerms: BackendSearchTerm[] = []
  terms.forEach((term) => {
    if (term.type === "invalid") return
    const value = term.value.trim().toLowerCase()
    if (term.type === "filename") {
      searchTerms.push({ field: "name", value, excluded: false, tag_type: "positive" })
      return
    }
    if (term.type === "info") {
      searchTerms.push({ field: "info", value, excluded: false, tag_type: "positive" })
      return
    }
    searchTerms.push({
      field: "tag",
      value,
      excluded: term.exclude,
      tag_type: term.type === "negativeTag" ? "negative" : "positive",
    })
  })
  return searchTerms
}
