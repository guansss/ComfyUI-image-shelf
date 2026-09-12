import exifr from "exifr"

import { ComfyWorkflowJSON } from "../comfy-shims"
import { NotRecognizedError } from "./error"
import { decodeUserComment, getJpegMetadata } from "./jpeg"

interface ImageMetadata {
  workflow?: Record<string, unknown>
  infotext: string
  prompt?: string
  negativePrompt?: string
}

export async function getMetadataFromFile(file: File): Promise<ImageMetadata | undefined> {
  try {
    const data = await window.comfyAPI?.parser.getWorkflowDataFromFile(file)
    if (data?.workflow) {
      return parseGenerationInfo(data.workflow as ComfyWorkflowJSON)
    }
  } catch (e) {
    // if Comfy fails to parse the metadata, we just ignore it and use our own methods
    console.warn("getWorkflowDataFromFile failed", e)
  }

  const exif = await exifr.parse(file, {
    // we can only pick tags for JPEG files， it does not work well with PNG
    pick: file.type === "image/jpeg" ? ["Software", "UserComment"] : undefined,
  })

  if (exif?.workflow) {
    return parseGenerationInfo(exif.workflow)
  }
  if (exif?.parameters) {
    return parseGenerationInfo(exif.parameters)
  }

  const software = exif?.Software
  const userComment = exif?.userComment

  if (typeof software === "string" && (!userComment || userComment instanceof Uint8Array)) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    try {
      const jpegMetadata = await getJpegMetadata(
        bytes,
        software,
        userComment as Uint8Array<ArrayBuffer>,
      )
      return parseGenerationInfo(jpegMetadata.generationInfo)
    } catch (e) {
      if (!(e instanceof NotRecognizedError)) {
        throw e
      }
    }
  }

  if (userComment instanceof Uint8Array) {
    const generationInfo = await decodeUserComment(userComment as Uint8Array<ArrayBuffer>)
    return parseGenerationInfo(generationInfo)
  }
  return undefined
}

function parseGenerationInfo(info: unknown): ImageMetadata | undefined {
  if (!info) return undefined

  if (typeof info === "string") {
    try {
      const parsedJson = JSON.parse(info)
      if (parsedJson && typeof parsedJson === "object") {
        info = parsedJson
      }
    } catch {
      // ignore JSON parse errors
    }

    // if info is not a JSON, try to parse it as A1111 prompts
    if (typeof info === "string") {
      try {
        const prompts = getA1111Prompts(info)
        return {
          infotext: info,
          ...prompts,
        }
      } catch (e) {
        if (!(e instanceof NotRecognizedError)) {
          throw e
        }
      }
    }
  }

  // if info is an object, assume it is a Comfy workflow JSON
  if (typeof info === "object") {
    return {
      workflow: info as Record<string, unknown>,
      infotext: JSON.stringify(info, null, 2),
      ...getComfyPrompts(info as Record<string, unknown>),
    }
  }

  return undefined
}

const promptRegex = /prompt/i
const negativePromptRegex = /negative[_ ]?prompt/i

function getComfyPrompts(workflow: Record<string, unknown>): {
  prompt?: string
  negativePrompt?: string
} {
  let prompt: string | undefined
  let negativePrompt: string | undefined
  if (Array.isArray(workflow.nodes)) {
    for (const node of workflow.nodes) {
      if (typeof node.title === "string") {
        if (negativePromptRegex.test(node.title)) {
          if (Array.isArray(node.widgets_values) && typeof node.widgets_values[0] === "string") {
            negativePrompt ||= node.widgets_values[0]
          }
        } else if (promptRegex.test(node.title)) {
          if (Array.isArray(node.widgets_values) && typeof node.widgets_values[0] === "string") {
            prompt ||= node.widgets_values[0]
          }
        }
        if (prompt && negativePrompt) {
          break
        }
      }
    }
  }
  return { prompt, negativePrompt }
}

const PARAMETERS_RE = /^Steps:\s*\d+,/m

export function getA1111Prompts(infotext: string): {
  prompt?: string
  negativePrompt?: string
} {
  const match = PARAMETERS_RE.exec(infotext)

  if (!match) {
    throw new NotRecognizedError("No A1111 parameters line found")
  }

  // Everything before the parameters line.
  const promptSection = infotext.slice(0, match.index).trim()

  const negativeMatch = /\nNegative prompt:\s*/.exec(promptSection)

  if (!negativeMatch) {
    return {
      prompt: promptSection,
      negativePrompt: undefined,
    }
  }

  return {
    prompt: promptSection.slice(0, negativeMatch.index).trim(),
    negativePrompt: promptSection.slice(negativeMatch.index + negativeMatch[0].length).trim(),
  }
}

export function replaceTags<T>(
  prompt: string,
  tags: string[],
  replacer: (tag: string, matchedText: string, occurrence: number) => T,
): (string | T)[] {
  const loweredPrompt = prompt.toLowerCase()
  const sortedTags = [...tags].sort((a, b) => b.length - a.length) // Sort tags by length to avoid partial matches
  const matches: { tag: string; index: number }[] = []

  for (const tag of sortedTags) {
    if (!tag) continue

    const loweredTag = tag.toLowerCase()
    let index = -1
    let searchStart = 0

    while ((index = loweredPrompt.indexOf(loweredTag, searchStart)) !== -1) {
      searchStart = index + loweredTag.length

      const overlaps = matches.some(
        (match) => index < match.index + match.tag.length && match.index < index + tag.length,
      )

      if (!overlaps) matches.push({ tag, index })
    }
  }

  matches.sort((a, b) => a.index - b.index) // Sort by index in prompt

  const nodes: (string | T)[] = []
  let prevIndex = 0

  for (const [occurrence, match] of matches.entries()) {
    const { tag, index } = match
    if (index < prevIndex) continue
    const beforeTag = prompt.slice(prevIndex, index)
    if (beforeTag) nodes.push(beforeTag)
    nodes.push(replacer(tag, prompt.slice(index, index + tag.length), occurrence))
    prevIndex = index + tag.length
  }

  const remaining = prompt.slice(prevIndex)
  if (remaining) nodes.push(remaining)
  return nodes
}
