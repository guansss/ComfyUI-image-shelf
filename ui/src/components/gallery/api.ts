import useSWRImmutable from "swr/immutable"

import { SERVER_URL } from "../../global"
import {
  fetchImageDetails,
  fetchImages,
  fetchFolders,
  fetchTagSuggestions,
  ImageQuery,
} from "../../services/gallery"

interface ImageQueryOptions extends ImageQuery {}

export function useImageQuery({ ...req }: ImageQueryOptions) {
  return useSWRImmutable(
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

export function useFolderList() {
  return useSWRImmutable("folders", async () => {
    const folderList = await fetchFolders()
    return folderList.items
  })
}

export function useTagSuggestions({ query }: { query?: string }) {
  return useSWRImmutable(
    query ? ["tagSuggestions", query] : null,
    async ([, query]) => {
      const tagSuggestions = await fetchTagSuggestions(query, 100)
      return tagSuggestions.items
    },
    { keepPreviousData: true },
  )
}

export function useImageDetails({ imageId }: { imageId?: string }) {
  return useSWRImmutable(imageId ? ["imageDetails", imageId] : null, async ([, imageId]) => {
    const imageDetails = await fetchImageDetails(imageId)
    return imageDetails
  })
}
