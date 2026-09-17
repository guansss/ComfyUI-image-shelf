import { describe, expect, test, vi } from "vitest"

import { fetchImages } from "../src/services/gallery"

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
})
