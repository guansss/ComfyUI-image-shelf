import useSWR from "swr"

import { SERVER_URL } from "../../global"
import {
  fetchFolders,
  fetchImageDetails,
  fetchImages,
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
        if (image.thumbnail_url) {
          image.thumbnail_url = new URL(image.thumbnail_url, SERVER_URL).toString()
        }
      })
      return imageList
    },
    { keepPreviousData: true },
  )
}

export function useFolderList() {
  return useSWR("folders", async () => {
    const folderList = await fetchFolders()
    return folderList.items
  })
}

export function useTagSuggestions({ query }: { query?: string }) {
  return useSWR(
    ["tagSuggestions", query],
    async ([, query]) => {
      const tagSuggestions = await fetchTagSuggestions(query, 100)
      return tagSuggestions.items
    },
    { keepPreviousData: true, dedupingInterval: 5000 },
  )
}

export function useImageDetails({ imageId }: { imageId?: string }) {
  return useSWR(imageId ? ["imageDetails", imageId] : null, async ([, imageId]) => {
    const imageDetails = await fetchImageDetails(imageId)
    return imageDetails
  })
}
