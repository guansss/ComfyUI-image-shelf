import { describe, expect, it } from "vitest"

import { parseSearchValue, queryToString, SearchTerm } from "../src/lib/search"

function parse(value: string) {
  const cursorIndex = value.indexOf("|")
  const valueWithoutPipe =
    cursorIndex === -1 ? value : value.slice(0, cursorIndex) + value.slice(cursorIndex + 1)
  return parseSearchValue(valueWithoutPipe, cursorIndex)
}

describe("parseSearchValue", () => {
  it("parses, reconstructs, and identifies active term correctly", () => {
    function check(
      value: string,
      expectedOutput: string,
      activeTerm: Partial<SearchTerm> | undefined,
      allowInvalid = false,
    ) {
      const parsed = parse(value)
      if (!allowInvalid) {
        const invalidTerms = parsed.terms.filter((term) => term.type === "invalid")
        if (invalidTerms.length > 0) {
          throw new Error(
            `Found invalid terms in parsed result for value "${value}": ${invalidTerms.map((t) => t.value)}`,
          )
        }
      }
      expect(queryToString(parsed)).toBe(expectedOutput)
      try {
        if (activeTerm === undefined) {
          expect(parsed.activeTerm).toBeUndefined()
        } else {
          expect(parsed.activeTerm).toMatchObject(activeTerm)
        }
      } catch (error) {
        throw new Error(`Active term mismatch for value "${value}": ${error}`)
      }
      try {
        expect(parse(expectedOutput).terms).toMatchObject(parsed.terms)
      } catch (error) {
        throw new Error(`Re-parse mismatch for value "${value}": ${error}`)
      }
    }

    check("| ", "", undefined)
    check(" |", "", undefined)
    check("cat", "cat", undefined)
    check('"orange cat"', '"orange cat"', undefined)
    check("|cat", "cat", { value: "cat" })
    check("cat|", "cat", { value: "cat" })
    check("cat|  ", "cat", { value: "cat" })
    check("  |cat  ", "cat", { value: "cat" })
    check("tag:cat|", "tag:cat", { value: "cat" })
    check("tag:|cat", "tag:cat", { value: "cat" })
    check("t|ag:cat", "tag:cat", { value: "cat" })
    check("|tag:cat", "tag:cat", { value: "cat" })
    check("tag:cat | dog", "tag:cat dog", undefined)
    check("tag:cat |dog", "tag:cat dog", { value: "dog" })
    check("tag:cat | dog", "tag:cat dog", undefined)
    check("tag:cat  |dog", "tag:cat dog", { value: "dog" })
    check('tag:"orange |cat"', 'tag:"orange cat"', { value: "orange cat" })
    check("tag:orange |cat", "tag:orange cat", { value: "cat" })

    check(
      '  tag:cat   name:"sunset |beach"  prompt:workflow ',
      'tag:cat name:"sunset beach" prompt:workflow',
      { value: "sunset beach" },
    )
    check(
      '  tag:cat   name:"sunset  |  beach"  prompt:workflow ',
      'tag:cat name:"sunset    beach" prompt:workflow',
      { value: "sunset    beach" },
    )

    check("-tag:cat|", "-tag:cat", { value: "cat", type: "tag", exclude: true })
    check("tag:-cat|", "tag:-cat", { value: "cat", type: "negativeTag", exclude: false })
    check("-tag:-cat|", "-tag:-cat", { value: "cat", type: "negativeTag", exclude: true })
    check("-cat|", "-cat", { value: "cat", type: "tag", exclude: true })
    check("tag:tag:cat|", "tag:tag:cat", { value: "tag:cat", type: "tag" })
    check("tag:name:cat|", "tag:name:cat", { value: "name:cat", type: "tag" })

    // preserve quotes even when unnecessary
    check('"cat" |"dog"', '"cat" "dog"', { value: "dog" })
    check('tag:"cat"|', 'tag:"cat"', { value: "cat" })

    // invalid terms
    check("tag:| cat", "tag: cat", { value: "tag:", type: "invalid", quoted: false }, true)
    check('cat "dog|', 'cat "dog', { value: '"dog', type: "invalid", quoted: false }, true)
    check('"cat "dog|', '"cat "dog', { value: '"dog', type: "invalid", quoted: false }, true)
    check('"cat| dog', '"cat dog', { value: '"cat', type: "invalid", quoted: false }, true)
    check('"cat dog|', '"cat dog', { value: "dog" }, true)
    check('tag:"cat|', 'tag:"cat', { value: 'tag:"cat', type: "invalid", quoted: false }, true)
    check('"tag:cat|', '"tag:cat', { value: '"tag:cat', type: "invalid", quoted: false }, true)
    check("foo:cat|", "foo:cat", { value: "foo:cat", type: "invalid", quoted: false }, true)
  })
})
