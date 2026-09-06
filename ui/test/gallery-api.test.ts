import { describe, test } from "vitest"

import { fetchImages } from "../src/services/gallery"

describe("gallery API client", () => {
  test("sends server-side gallery controls as query parameters", async () => {
    const result = await fetchImages({
      tab: "outputs",
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
  })
})
