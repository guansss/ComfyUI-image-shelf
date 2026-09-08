import useSWR from "swr"

import { SERVER_URL } from "../../global"
import { getMetadataFromFile } from "../../lib/metadata"
import {
  fetchImageDetails,
  fetchImages,
  fetchTabs,
  fetchTagSuggestions,
  ImageQuery,
} from "../../services/gallery"
import { api } from "../../services/network"

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
      const tagSuggestions = await fetchTagSuggestions(query)
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

export function useImageMetadata({ filename, url }: { filename?: string; url?: string }) {
  return useSWR(url ? ["imageMetadata", url] : null, async ([, url]) => {
    const isCrossOrigin = new URL(url).origin !== new URL(location.href).origin
    if (isCrossOrigin) {
      // Since the image has already been loaded with a <img> tag, which loads the image
      // with "no-cors" mode, fetching the same URL again with "cors" mode will be rejected
      // by the browser. To work around this, we append an arbitrary query parameter to
      // the URL to force the browser to treat it as a different request.
      const newUrl = new URL(url)
      newUrl.searchParams.append("cors", "114514")
      url = newUrl.toString()
    }
    const blob = await api<Blob>(
      url,
      "GET",
      undefined,
      async (res, _defaultHandler, defaultErrorHandler) => {
        if (res.ok) {
          return await res.blob()
        }
        throw await defaultErrorHandler()
      },
    )

    const file = new File([blob], filename || "image", { type: blob.type })
    const metadata = await getMetadataFromFile(file)
    if (metadata) {
      return {
        ...metadata,
        workflowText: JSON.stringify(metadata.workflow, null, 2),
      }
    }
    return undefined
  })
}
