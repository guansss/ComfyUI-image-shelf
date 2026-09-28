import { describe, expect, test, vi } from "vitest"

import {
  fetchAppInfo,
  fetchImages,
  transferAssets,
  transferImage,
  transferImages,
} from "../src/services/gallery"

describe("gallery API client", () => {
  test("fetches application file information", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          database_path: "C:/data/image-shelf.sqlite3",
          database_size: 1024,
          settings_path: "C:/data/settings.json",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )

    await expect(fetchAppInfo()).resolves.toEqual({
      database_path: "C:/data/image-shelf.sqlite3",
      database_size: 1024,
      settings_path: "C:/data/settings.json",
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("info"),
      expect.objectContaining({ method: "GET" }),
    )
    fetchMock.mockRestore()
  })

  test("sends server-side gallery controls as query parameters", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [],
          page: 2,
          page_size: 36,
          total: 0,
          dimensions: [],
          elapsed: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )

    await fetchImages({
      folder: "outputs",
      query: {
        terms: [
          {
            type: "tag",
            value: "cat",
            quoted: false,
            prefix: "",
            exclude: false,
          },
        ],
        activeTerm: undefined,
      },
      dimensions: ["512x512"],
      sort: "filename",
      direction: "asc",
      page: 2,
      pageSize: 36,
    })

    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.searchParams.get("folder")).toBe("outputs")
    expect(url.searchParams.get("tab")).toBeNull()
    expect(url.searchParams.get("page")).toBe("2")
    expect(url.searchParams.get("page_size")).toBe("36")
    fetchMock.mockRestore()
  })

  test("transfers an image to a selected folder", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ folder: "custom", filename: "image.png", mode: "move" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await transferImage("image/id", "custom", "move")

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("images/image%2Fid/transfer"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          folder: "custom",
          mode: "move",
          filename: undefined,
          conflict: "suggest",
        }),
      }),
    )
    fetchMock.mockRestore()
  })

  test("transfers multiple images through the batch endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          folder: "custom",
          mode: "copy",
          items: [
            { image_id: "one", filename: "one.png" },
            { image_id: "two", filename: "two.png" },
          ],
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    )

    await transferImages(["one", "two"], "custom", "copy", "suggest")

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("batch/images/transfer"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          image_ids: ["one", "two"],
          folder: "custom",
          mode: "copy",
          conflict: "suggest",
          filenames: undefined,
        }),
      }),
    )
    fetchMock.mockRestore()
  })

  test("transfers ComfyUI assets with custom filenames", async () => {
    const items = [{ filename: "image.png", subfolder: "nested", type: "output" }]
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          folder: "custom",
          mode: "move",
          items: [{ item: items[0], filename: "renamed.png" }],
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    )

    await transferAssets(items, "custom", "move", "suggest", { "0": "renamed.png" })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("assets/transfer"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          items,
          folder: "custom",
          mode: "move",
          conflict: "suggest",
          filenames: { "0": "renamed.png" },
        }),
      }),
    )
    fetchMock.mockRestore()
  })

  test("preserves asset indices from filename conflicts", async () => {
    const item = { filename: "image.png", subfolder: "nested", type: "output" }
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "filename_conflicts",
          conflicts: [
            {
              index: 0,
              filename: "image.png",
              suggested_filename: "image_1.png",
            },
          ],
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    )

    await expect(transferAssets([item], "custom", "copy")).rejects.toMatchObject({
      conflicts: [
        {
          index: 0,
          filename: "image.png",
          suggested_filename: "image_1.png",
        },
      ],
    })
    fetchMock.mockRestore()
  })
})
