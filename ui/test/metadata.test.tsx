import { describe, expect, it } from "vitest"

import { replaceTags } from "../src/lib/metadata"

describe("replaceTags", () => {
  it("replaces every non-overlapping occurrence", () => {
    const result = replaceTags(
      "cat, cat",
      ["cat"],
      (tag, _matchedText, occurrence) => `${tag}-${occurrence}`,
    )

    expect(result).toEqual(["cat-0", ", ", "cat-1"])
  })

  it("prefers the longest tag when tags overlap", () => {
    const result = replaceTags("cater", ["cat", "cater", "er"], (tag) => `[${tag}]`)

    expect(result).toEqual(["[cater]"])
  })

  it("matches tags case-insensitively", () => {
    const result = replaceTags("A CAT", ["cat"], (_tag, matchedText, _occurrence) => {
      return `[${matchedText}]`
    })

    expect(result).toEqual(["A ", "[CAT]"])
  })
})
