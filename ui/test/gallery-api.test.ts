import { describe, expect, test, vi } from "vitest"

import { fetchImages, transferImage } from "../src/services/gallery"

describe("gallery API client", () => {
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
        body: JSON.stringify({ folder: "custom", mode: "move", filename: undefined }),
      }),
    )
    fetchMock.mockRestore()
  })
})
