import { describe, expect, test } from "vitest"

import { moveCustomFolder } from "../src/lib/folder"
import { CustomFolderSetting } from "../src/lib/settings"

const folders: CustomFolderSetting[] = [
  { id: "one", name: "One", path: "C:/one" },
  { id: "two", name: "Two", path: "C:/two" },
  { id: "three", name: "Three", path: "C:/three" },
]

describe("moveCustomFolder", () => {
  test("swaps a folder with its adjacent folder in either direction", () => {
    expect(moveCustomFolder(folders, "two", "up").map((folder) => folder.id)).toEqual([
      "two",
      "one",
      "three",
    ])
    expect(moveCustomFolder(folders, "two", "down").map((folder) => folder.id)).toEqual([
      "one",
      "three",
      "two",
    ])
  })

  test("leaves folders unchanged when the destination is outside the array", () => {
    expect(moveCustomFolder(folders, "one", "up")).toBe(folders)
    expect(moveCustomFolder(folders, "three", "down")).toBe(folders)
  })
})
