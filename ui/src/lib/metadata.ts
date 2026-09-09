import exifr from "exifr"

interface ImageMetadata {
  workflow?: Record<string, unknown>
  infotext: string
  prompt?: string
  negativePrompt?: string
}

export async function getMetadataFromFile(file: File): Promise<ImageMetadata | undefined> {
  const data = await window.comfyAPI.parser.getWorkflowDataFromFile(file)

  if (data) {
    let workflow: unknown

    if (data && data.workflow) {
      workflow = data.workflow
    }
    if (typeof workflow === "string") {
      workflow = JSON.parse(workflow)
    }
    if (typeof workflow === "object" && workflow !== null) {
      return {
        workflow: workflow as Record<string, unknown>,
        infotext: JSON.stringify(workflow, null, 2),
        ...getComfyPrompts(workflow as Record<string, unknown>),
      }
    }
  } else {
    const data = await exifr.parse(file, {
      pick: ["UserComment"],
    })
    const userComment = data?.userComment
    if (userComment && userComment instanceof Uint8Array) {
      const text = decodeUserComment(userComment)
      const prompts = getA1111Prompts(text)
      if (prompts) {
        return {
          infotext: text,
          ...prompts,
        }
      }
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
} | null {
  const match = PARAMETERS_RE.exec(infotext)

  if (!match) {
    return null
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

function decodeUserComment(data: Uint8Array): string {
  if (startsWith(data, new TextEncoder().encode("UNICODE\0")))
    return decodeUnicode(data.subarray(8))
  if (startsWith(data, new TextEncoder().encode("ASCII\0\0\0")))
    return new TextDecoder("ascii").decode(data.subarray(8))
  if (startsWith(data, new TextEncoder().encode("JIS\0\0\0\0\0")))
    return new TextDecoder("shift-jis").decode(data.subarray(8))
  return new TextDecoder("utf-8").decode(data)
}

function startsWith(data: Uint8Array, prefix: Uint8Array): boolean {
  if (data.length < prefix.length) return false
  return prefix.every((byte, index) => data[index] === byte)
}

function decodeUnicode(data: Uint8Array): string {
  if (data.length === 0) return ""

  // EXIF specifies Unicode UserComment as UCS-2.
  // In practice, A1111/piexif uses UTF-16-compatible encoding.
  //
  // Prefer the BOM when present.
  if (data.length >= 2) {
    const bom = (data[0] << 8) | data[1]
    if (bom === 0xfeff) return new TextDecoder("utf-16be").decode(data.subarray(2))
    if (bom === 0xfffe) return new TextDecoder("utf-16le").decode(data.subarray(2))
  }

  // A1111/piexif writes big-endian UTF-16 on normal systems.
  return new TextDecoder("utf-16be").decode(data)
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
