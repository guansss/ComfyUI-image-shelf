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
  metadata: string
  workflow: unknown
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

  let rawData: Uint8Array<ArrayBuffer>

  if (header.storage === "comment") {
    if (!userComment) {
      throw new Error("Workflow is declared as UserComment storage")
    }

    rawData = userComment
  } else {
    rawData = findApp15Payload(jpeg, header)
  }

  validatePayload(rawData, header)

  const { decoded, workflow } = await decodeWorkflow(rawData, header.encoding)

  return {
    header,
    metadata: decoded,
    workflow,
  }
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

/**
 * Decode a zero-terminated EXIF ASCII Software value.
 *
 * EXIF Software is normally ASCII and may contain a trailing NUL.
 */
function decodeExifSoftware(data: Uint8Array): string {
  let end = data.indexOf(0)

  if (end === -1) {
    end = data.length
  }

  return new TextDecoder("ascii", {
    fatal: true,
  }).decode(data.subarray(0, end))
}

/**
 * Parse a JPEG and return its EXIF APP1 payload.
 *
 * This does not parse all EXIF structures itself. It extracts the APP1
 * payload so that an EXIF parser can be used on it.
 */
function findExifApp1(jpeg: Uint8Array): Uint8Array | undefined {
  assertJpeg(jpeg)

  let offset = 2

  while (offset < jpeg.length) {
    if (jpeg[offset] !== 0xff) {
      throw new Error(`Invalid JPEG marker at offset ${offset}`)
    }

    // Skip fill bytes.
    while (offset < jpeg.length && jpeg[offset] === 0xff) {
      offset++
    }

    if (offset >= jpeg.length) {
      break
    }

    const marker = jpeg[offset++]

    // Standalone markers.
    if (marker === 0xd8) {
      throw new Error("Unexpected SOI marker")
    }

    if (marker === 0xd9) {
      break
    }

    if (marker === 0xda) {
      // SOS: compressed image data starts here.
      break
    }

    // TEM and restart markers have no length.
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

    if (marker === 0xe1) {
      if (
        payload.length >= 6 &&
        payload[0] === 0x45 && // E
        payload[1] === 0x78 && // x
        payload[2] === 0x69 && // i
        payload[3] === 0x66 && // f
        payload[4] === 0x00 &&
        payload[5] === 0x00
      ) {
        return payload
      }
    }

    offset += length - 2
  }

  return undefined
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
 * Extract the raw UserComment bytes from an EXIF structure.
 *
 * This function intentionally does not interpret the UserComment encoding
 * because this format stores raw gzip bytes there.
 *
 * You need to provide an EXIF parser's result to this function.
 */
function getRawUserComment(exifSubIFD: Record<number, Uint8Array | undefined>): Uint8Array {
  // EXIF UserComment = 0x9286
  const userComment = exifSubIFD[0x9286]

  if (!userComment) {
    throw new Error("EXIF UserComment not found")
  }

  return userComment
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

/**
 * Decode the compressed workflow payload into JSON.
 */
async function decodeWorkflow(
  data: Uint8Array<ArrayBuffer>,
  encoding: Encoding,
): Promise<{ decoded: string; workflow: unknown }> {
  let decoded: string

  if (encoding === ENCODING_GZIP_UTF8) {
    const decompressed = await decompressGzip(data)
    decoded = new TextDecoder("utf-8").decode(decompressed)
  } else if (encoding === ENCODING_UTF16BE) {
    decoded = new TextDecoder("utf-16be").decode(data)
  } else {
    throw new Error(`Unsupported encoding: ${encoding}`)
  }

  try {
    const workflow = JSON.parse(decoded)
    return { decoded, workflow }
  } catch (error) {
    throw new Error(
      `Invalid workflow JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
