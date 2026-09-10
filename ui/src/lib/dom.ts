export const Z_POPOVER = "z-2000"

export const rootContainer = document.createElement("div")
rootContainer.id = "imsh"
rootContainer.className = "dark pointer-events-auto"
document.body.appendChild(rootContainer)

export const portalRoot = rootContainer

export async function copyToClipboard(text: string) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text)
    }
  } catch (e) {
    console.warn("Failed to copy text to clipboard:", e)
  }
}
