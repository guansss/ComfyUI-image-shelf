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
