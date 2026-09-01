import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const file = resolve("node_modules/@comfyorg/comfyui-frontend-types/index.d.ts")

let content = await readFile(file, "utf8")

const fixed = content.replace(
  /^([ \t]*)declare\s+(?=(class|interface|type|function|const|let|var|namespace|enum)\b)/gm,
  "$1export declare ",
)

if (fixed !== content) {
  await writeFile(file, fixed)
  console.log(`Patched ${file}`)
} else {
  console.log(`No changes needed: ${file}`)
}
