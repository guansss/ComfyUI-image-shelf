interface ImageMetadata {
  workflow: Record<string, unknown>
  positivePrompt?: string
  negativePrompt?: string
}

export async function getMetadataFromFile(file: File): Promise<ImageMetadata | undefined> {
  const data = await window.comfyAPI.parser.getWorkflowDataFromFile(file)

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
      ...parsePrompts(workflow as Record<string, unknown>),
    }
  }
  return undefined
}

const promptRegex = /prompt/i
const negativePromptRegex = /negative[_ ]?prompt/i

function parsePrompts(workflow: Record<string, unknown>): {
  positivePrompt?: string
  negativePrompt?: string
} {
  let positivePrompt: string | undefined
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
            positivePrompt ||= node.widgets_values[0]
          }
        }
        if (positivePrompt && negativePrompt) {
          break
        }
      }
    }
  }
  return { positivePrompt, negativePrompt }
}
