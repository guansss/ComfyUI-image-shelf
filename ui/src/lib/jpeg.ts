import { arraysEqual } from "../utils/lang"
import { NotRecognizedError } from "./error"

export interface MetadataHeader {
  formatVersion: number
  extensionVersion?: string
  storage: StorageMode
  size: number
  chunks: number
  encoding: Encoding
}

export interface ParsedJpegMetadata {
  header: MetadataHeader
  generationInfo: string
}

type StorageMode = typeof STORAGE_COMMENT | typeof STORAGE_APP15
type Encoding = typeof ENCODING_UTF16BE | typeof ENCODING_GZIP_UTF8

const FORMAT_NAME = "ComfyUI-Image-Shelf"
const FORMAT_VERSION = 1

const STORAGE_COMMENT = "comment"
const STORAGE_APP15 = "app15"

const ENCODING_UTF16BE = "utf-16be"
const ENCODING_GZIP_UTF8 = "gzip_utf-8"

const APP15 = 0xffef
const SOI = 0xffd8
const SOS = 0xffda

export async function getJpegMetadata(
  jpeg: Uint8Array<ArrayBuffer>,
  software: string,
  userComment?: Uint8Array<ArrayBuffer>,
): Promise<ParsedJpegMetadata> {
  const header = parseSoftwareHeader(software)

  let generationInfo: string

  if (header.storage === "comment") {
    if (!userComment) {
      throw new Error("Metadata says UserComment storage, but UserComment is missing")
    }

    validatePayload(userComment, header)
    generationInfo = await decodeUserComment(userComment, header.encoding)
  } else {
    const payload = findApp15Payload(jpeg, header)
    validatePayload(payload, header)
    generationInfo = await decodeValue(payload, header.encoding)
  }

  return { header, generationInfo }
}

/**
 * Parse the EXIF Software manifest.
 *
 * Example:
 *   ComfyUI-Image-Shelf;v=1;ext=1.2.3;storage=app15;size=123456;chunks=2;encoding=gzip
 */
function parseSoftwareHeader(software: string): MetadataHeader {
  if (!software.startsWith(FORMAT_NAME)) {
    throw new NotRecognizedError(`Not a ComfyUI-Image-Shelf metadata header: ${software}`)
  }

  const parts = software.slice(FORMAT_NAME.length).split(";")
  const fields: Record<string, string> = Object.fromEntries(
    parts.map((p) => p.split("=", 2).map((s) => s.trim())),
  )

  const formatVersion = parsePositiveInteger(fields["v"], "version")
  if (formatVersion > FORMAT_VERSION) {
    throw new Error(`Unsupported format version: ${formatVersion}`)
  }

  const storage = fields["storage"]
  if (storage !== STORAGE_COMMENT && storage !== STORAGE_APP15) {
    throw new Error(`Unsupported storage mode: ${storage}`)
  }

  const encoding = fields["encoding"]
  if (encoding !== ENCODING_UTF16BE && encoding !== ENCODING_GZIP_UTF8) {
    throw new Error(`Unsupported encoding: ${encoding}`)
  }

  const size = parseNonNegativeInteger(fields["size"], "size")
  const chunks = parsePositiveInteger(fields["chunks"], "chunks")
  const extensionVersion = fields["ext"]

  if (storage === STORAGE_COMMENT && chunks !== 1) {
    throw new Error(`UserComment storage must have chunks=1, got ${chunks}`)
  }
  if (size === 0) {
    throw new Error("Workflow payload is empty")
  }

  return {
    formatVersion,
    extensionVersion,
    storage,
    size,
    chunks,
    encoding,
  }
}

function parseNonNegativeInteger(value: string | undefined, name: string): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new Error(`Invalid ${name}: ${value}`)
  }

  const result = Number(value)

  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`Invalid ${name}: ${value}`)
  }

  return result
}

function parsePositiveInteger(value: string | undefined, name: string): number {
  const result = parseNonNegativeInteger(value, name)

  if (result <= 0) {
    throw new Error(`${name} must be greater than zero`)
  }

  return result
}

export async function decodeUserComment(
  data: Uint8Array<ArrayBuffer>,
  encoding?: Encoding,
): Promise<string> {
  const prefix = data.subarray(0, 8)
  const payload = data.subarray(8)

  if (arraysEqual(prefix, new TextEncoder().encode("UNICODE\0"))) {
    if (encoding && encoding !== ENCODING_UTF16BE) {
      throw new Error(`Unsupported encoding for UNICODE UserComment: ${encoding}`)
    }
    return new TextDecoder("utf-16be").decode(payload)
  } else if (arraysEqual(prefix, new TextEncoder().encode("ASCII\0\0\0"))) {
    return new TextDecoder("ascii").decode(payload)
  } else if (arraysEqual(prefix, new TextEncoder().encode("JIS\0\0\0\0\0"))) {
    return new TextDecoder("shift-jis").decode(payload)
  } else if (arraysEqual(prefix, new TextEncoder().encode("\0\0\0\0\0\0\0\0"))) {
    if (!encoding) {
      throw new Error("Encoding must be specified for UNDEFINED UserComment prefix")
    }
    return decodeValue(payload, encoding)
  }
  throw new Error(`Unsupported UserComment prefix: ${prefix.toString()}`)
}

async function decodeValue(data: Uint8Array<ArrayBuffer>, encoding: Encoding): Promise<string> {
  if (encoding === ENCODING_GZIP_UTF8) {
    const decompressed = await decompressGzip(data)
    return new TextDecoder("utf-8").decode(decompressed)
  } else if (encoding === ENCODING_UTF16BE) {
    return new TextDecoder("utf-16be").decode(data)
  }
  throw new Error(`Unsupported encoding: ${encoding}`)
}

/**
 * Find all APP15 segments belonging to the workflow.
 *
 * The format relies on the Software header to tell us how many APP15
 * segments and how many bytes to expect.
 *
 * This implementation collects a contiguous APP15 run before SOS.
 */
function findApp15Payload(
  jpeg: Uint8Array<ArrayBuffer>,
  header: MetadataHeader,
): Uint8Array<ArrayBuffer> {
  if (header.storage !== "app15") {
    throw new Error("findApp15Payload called for non-APP15 storage")
  }

  assertJpeg(jpeg)

  let offset = 2
  let found: Uint8Array<ArrayBuffer>[] | undefined

  while (offset < jpeg.length) {
    if (jpeg[offset] !== 0xff) {
      throw new Error(`Invalid JPEG marker at offset ${offset}`)
    }

    // Skip marker fill bytes.
    while (offset < jpeg.length && jpeg[offset] === 0xff) {
      offset++
    }

    if (offset >= jpeg.length) {
      break
    }

    const marker = jpeg[offset++]

    if (marker === 0xd9 || marker === 0xda) {
      break
    }

    // Standalone markers.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue
    }

    if (offset + 2 > jpeg.length) {
      throw new Error("Truncated JPEG segment length")
    }

    const length = readUint16BE(jpeg, offset)
    offset += 2

    if (length < 2 || offset + length - 2 > jpeg.length) {
      throw new Error("Invalid JPEG segment length")
    }

    const payload = jpeg.subarray(offset, offset + length - 2)

    if (marker === 0xef) {
      // APP15 run.
      if (!found) {
        found = []
      }

      found.push(payload)

      if (found.length === header.chunks) {
        break
      }
    } else if (found) {
      // APP15 segments must be contiguous.
      break
    }

    offset += length - 2
  }

  if (!found) {
    throw new Error("No APP15 workflow payload found")
  }

  if (found.length !== header.chunks) {
    throw new Error(`Expected ${header.chunks} APP15 segments, found ${found.length}`)
  }

  const totalSize = found.reduce((sum, chunk) => sum + chunk.length, 0)

  if (totalSize !== header.size) {
    throw new Error(`APP15 payload size mismatch: expected ${header.size}, got ${totalSize}`)
  }

  const result = new Uint8Array(totalSize)

  let writeOffset = 0

  for (const chunk of found) {
    result.set(chunk, writeOffset)
    writeOffset += chunk.length
  }

  return result
}

function assertJpeg(data: Uint8Array): void {
  if (data.length < 2 || data[0] !== 0xff || data[1] !== 0xd8) {
    throw new Error("Not a JPEG file")
  }
}

function readUint16BE(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1]
}

/**
 * Validate a raw workflow payload against the Software header.
 */
function validatePayload(payload: Uint8Array, header: MetadataHeader): void {
  if (payload.length !== header.size) {
    throw new Error(`Payload size mismatch: expected ${header.size}, got ${payload.length}`)
  }

  if (header.storage === "comment" && header.chunks !== 1) {
    throw new Error("UserComment payload must have one chunk")
  }
}

/**
 * Decode gzip-compressed UTF-8 JSON.
 *
 * Browser implementation using the Compression Streams API.
 */
async function decompressGzip(
  compressed: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream is not available in this environment")
  }

  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"))

  const buffer = await new Response(stream).arrayBuffer()

  return new Uint8Array(buffer)
}
