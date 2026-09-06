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
    ) {
      const parsed = parse(value)
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
    check("tag:| cat", "tag: cat", { value: "tag:", type: "invalid", quoted: false })
    check('cat "dog|', 'cat "dog', { value: '"dog', type: "invalid", quoted: false })
    check('"cat "dog|', '"cat "dog', { value: '"dog', type: "invalid", quoted: false })
    check('"cat| dog', '"cat dog', { value: '"cat', type: "invalid", quoted: false })
    check('"cat dog|', '"cat dog', { value: "dog" })
    check('tag:"cat|', 'tag:"cat', { value: 'tag:"cat', type: "invalid", quoted: false })
    check('"tag:cat|', '"tag:cat', { value: '"tag:cat', type: "invalid", quoted: false })
    check("foo:cat|", "foo:cat", { value: "foo:cat", type: "invalid", quoted: false })
  })

  // it.skip("spliceTermInQuery", () => {
  //   function check(value: string, expected: string, replacer: Record<string, string>) {
  //     const parsed = parse(value)
  //     const newTerms = parsed.terms.map((term) => {
  //       for (const [key, replacement] of Object.entries(replacer)) {
  //         if (term.value.includes(key)) {
  //           return parseTerm(replacement)
  //         }
  //       }
  //       return term
  //     })
  //     const replaced = { ...parsed, terms: newTerms }

  //     try {
  //       expect(queryToString(replaced)).toBe(expected)
  //     } catch (error) {
  //       throw new Error(
  //         `Splice mismatch for value "${value}" with new terms [${newTerms.join(", ")}]: ${error}`,
  //       )
  //     }
  //   }

  //   check("tag:cat", "tag:cat dog", { "": "dog" })
  //   check("tag:cat", "dog tag:cat", 0, 0, ["dog"])
  //   check("tag:cat dog", "tag:cat ", 1, 1, [])
  //   check("tag:cat dog", "tag:cat tag:dog", 1, 1, ["tag:dog"])
  //   check("tag:cat dog", "tag:cat tag:-dog", 1, 1, ["tag:-dog"])
  //   check("tag:cat dog", "tag:-cat -tag:dog", 0, 2, ["tag:-cat", "-tag:dog"])
  //   check("tag:cat dog", "tag:cat fish dog", 1, 0, ["fish"])

  //   check("", "cat", 0, 0, ["cat"])
  //   check("", "cat", 1, 0, ["cat"])
  //   check("  ", "cat  ", 0, 0, ["cat"])
  //   check("  cat   ", "    ", 0, 1, [])
  //   check("   cat", "dog   cat", 1, 0, ["dog"])
  //   check("cat  ", "cat  dog", 1, 0, ["dog"])
  //   check("cat   dog", "cat   ", 1, 0, [])
  //   check("cat   dog", "   dog", 1, 0, [])
  //   check("   cat   dog   ", "   cat fish  dog   ", 1, 0, ["fish"])
  //   check("   cat   fish   dog   ", "   cat   bird   dog   ", 1, 1, ["bird"])

  //   check(
  //     '  tag:cat   name:"sunset |beach"  prompt:workflow ',
  //     '  tag:cat   name:"room"  prompt:workflow ',
  //     1,
  //     1,
  //     ['name:"room"'],
  //   )
  // })
})
