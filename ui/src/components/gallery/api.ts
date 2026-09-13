import useSWR from "swr"

import { SERVER_URL } from "../../global"
import {
  fetchImageDetails,
  fetchImages,
  fetchTabs,
  fetchTagSuggestions,
  ImageQuery,
} from "../../services/gallery"

interface ImageQueryOptions extends ImageQuery {}

export function useImageQuery({ ...req }: ImageQueryOptions) {
  return useSWR(
    ["images", req],
    async () => {
      const imageList = await fetchImages(req)
      imageList.items.forEach((image) => {
        image.url = new URL(image.url, SERVER_URL).toString()
      })
      return imageList
    },
    { keepPreviousData: true },
  )
}

export function useTabList() {
  return useSWR("tabs", async () => {
    const tabList = await fetchTabs()
    return tabList.items
  })
}

export function useTagSuggestions({ query }: { query?: string }) {
  return useSWR(
    query ? ["tagSuggestions", query] : null,
    async ([, query]) => {
      const tagSuggestions = await fetchTagSuggestions(query, 100)
      return tagSuggestions.items
    },
    { keepPreviousData: true },
  )
}

export function useImageDetails({ imageId }: { imageId?: string }) {
  return useSWR(imageId ? ["imageDetails", imageId] : null, async ([, imageId]) => {
    const imageDetails = await fetchImageDetails(imageId)
    return imageDetails
  })
}
