import { describe, expect, test } from "vitest"

import { formatFileSize } from "../src/lib/utils"

describe("formatFileSize", () => {
  test("formats bytes using readable binary units", () => {
    expect(formatFileSize(512)).toBe("512 B")
    expect(formatFileSize(1024)).toBe("1.0 KB")
    expect(formatFileSize(1024 * 1024 * 2.5)).toBe("2.5 MB")
  })
})
