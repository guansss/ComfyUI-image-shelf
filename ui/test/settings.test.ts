import { describe, expect, test } from "vitest"

import { promptHintsSchema } from "../src/lib/settings"
import { formatFileSize } from "../src/lib/utils"

describe("formatFileSize", () => {
  test("formats bytes using readable binary units", () => {
    expect(formatFileSize(512)).toBe("512 B")
    expect(formatFileSize(1024)).toBe("1.0 KB")
    expect(formatFileSize(1024 * 1024 * 2.5)).toBe("2.5 MB")
  })
})

describe("promptHintsSchema", () => {
  const validHint = {
    id: "prompt-hint-text",
    class_type: "CLIPTextEncode",
    kind: "text" as const,
    input_name: "text",
    role: "positive" as const,
    ignore: false,
  }

  test("accepts valid hints", () => {
    expect(promptHintsSchema.safeParse([validHint]).success).toBe(true)
  })

  test("requires an input name", () => {
    const result = promptHintsSchema.safeParse([{ ...validHint, input_name: " " }])
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual([0, "input_name"])
    }
  })
})
