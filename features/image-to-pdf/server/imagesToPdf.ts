import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'

/**
 * Image → PDF conversion engine (server-only).
 *
 * This is the module's own logic, kept out of `app/api/image-to-pdf/route.ts`
 * so that route stays a thin validating handler (CLAUDE.md §5/§6). Only the
 * route imports this file; it is never re-exported from the `'use client'`
 * shim in `features/image-to-pdf/index.tsx`.
 *
 * Why the previous inline route was replaced (it re-encoded every input to PNG
 * and embedded it at full pixel size):
 *
 *   1. PNG is lossless, so a 3 MB phone JPEG became a 15-30 MB PNG in memory
 *      and an enormous PDF. Photographs now go through JPEG at a chosen
 *      quality; a JPEG that is already correctly sized and oriented is passed
 *      through untouched — zero re-encode.
 *   2. There was no resolution cap, so a 6000×4000 phone photo became a page
 *      half a metre across of bytes. Every image is now bounded on its long
 *      side — never enlarged — which caps both memory and output size.
 *   3. Conversion ran one image at a time. Independent images are now decoded
 *      in bounded parallel across cores, then embedded sequentially because
 *      `pdf-lib` is not concurrency-safe.
 *
 * The default page size is `original` — one page per image at its own
 * dimensions — so a user who changes nothing still gets the behaviour this
 * tool always promised; the new options are additive.
 */

export type PageSizeOption = 'original' | 'a4' | 'letter'
export type QualityOption = 'high' | 'balanced' | 'small'

export interface ConversionOptions {
  pageSize: PageSizeOption
  quality: QualityOption
}

export interface ConversionResult {
  bytes: Uint8Array
  pageCount: number
  /** Names of inputs sharp could not decode. The job still succeeds if any page was produced. */
  failed: string[]
}

/** Caller-fixable problem; the route maps it to a stable status/code. */
export class ImagesToPdfValidationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'ImagesToPdfValidationError'
  }
}

/* A4 and US Letter in PDF points (1 pt = 1/72 in). */
const FIXED_PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
} as const

const JPEG_QUALITY: Record<QualityOption, number> = {
  high: 92,
  balanced: 82,
  small: 68,
}

/**
 * Long-side ceilings. 3508 px is A4 at ~300 DPI; beyond it print detail stops
 * improving while RAM, CPU and file size keep climbing. `original` allows a
 * little more headroom (4000 px ≈ A3 at 300 DPI) because the user explicitly
 * asked to keep the image's own page size.
 */
const FIXED_PAGE_MAX_SIDE = 3508
const ORIGINAL_PAGE_MAX_SIDE = 4000

/** Print margin for fixed page sizes, in points (~6.3 mm). */
const PAGE_MARGIN = 18

/** sharp is CPU-bound; beyond a few in flight the wins flatten and RAM spikes. */
const CONCURRENCY = 4

interface PreparedImage {
  data: Uint8Array
  width: number
  height: number
}

/**
 * Decode, orient and bound one image, returning bytes ready for `pdf-lib`.
 *
 * Fast path: a JPEG that is already upright (EXIF orientation 1), has no alpha
 * and is within the size ceiling is embedded byte-for-byte — no generation
 * loss and no CPU spent re-encoding. Everything else is normalised through
 * sharp: EXIF rotation applied for real, alpha flattened onto white (a PDF
 * page is white, so transparency is not observable) and re-encoded as JPEG.
 */
async function prepareImage(
  file: File,
  options: ConversionOptions,
): Promise<PreparedImage> {
  const input = Buffer.from(await file.arrayBuffer())
  const maxSide =
    options.pageSize === 'original' ? ORIGINAL_PAGE_MAX_SIDE : FIXED_PAGE_MAX_SIDE

  const metadata = await sharp(input, { failOn: 'none' }).metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  const longSide = Math.max(width, height)
  const alreadyUpright = (metadata.orientation ?? 1) === 1

  if (
    metadata.format === 'jpeg' &&
    alreadyUpright &&
    !metadata.hasAlpha &&
    longSide > 0 &&
    longSide <= maxSide
  ) {
    return { data: input, width, height }
  }

  const oriented = sharp(input, { failOn: 'none' }).rotate()
  const bounded =
    longSide > maxSide
      ? oriented.resize({
          width: maxSide,
          height: maxSide,
          fit: 'inside',
          withoutEnlargement: true,
        })
      : oriented
  const flattened = metadata.hasAlpha
    ? bounded.flatten({ background: '#ffffff' })
    : bounded

  const { data, info } = await flattened
    .jpeg({ quality: JPEG_QUALITY[options.quality], mozjpeg: true })
    .toBuffer({ resolveWithObject: true })

  return { data, width: info.width, height: info.height }
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Convert an ordered list of images into one PDF.
 *
 * Order is the caller's order — index 0 is page 1 — because that is the
 * promise this tool makes (table order == page order). An image that cannot be
 * decoded is skipped and named in `failed`, matching the previous behaviour of
 * never letting one bad file sink a whole document; only an all-failed job
 * throws.
 */
export async function convertImagesToPdf(
  files: File[],
  options: ConversionOptions,
): Promise<ConversionResult> {
  const prepared = await mapWithConcurrency(files, CONCURRENCY, async (file) => {
    try {
      return { name: file.name, image: await prepareImage(file, options) }
    } catch {
      return { name: file.name, image: null }
    }
  })

  const usable = prepared.filter(
    (entry): entry is { name: string; image: PreparedImage } => entry.image !== null,
  )
  const failed = prepared.filter((entry) => entry.image === null).map((entry) => entry.name)

  if (!usable.length) {
    throw new ImagesToPdfValidationError(
      'No valid images could be processed',
      'no_valid_images',
    )
  }

  const pdf = await PDFDocument.create()

  for (const { image } of usable) {
    const embedded = await pdf.embedJpg(image.data)

    if (options.pageSize === 'original') {
      const page = pdf.addPage([embedded.width, embedded.height])
      page.drawImage(embedded, {
        x: 0,
        y: 0,
        width: embedded.width,
        height: embedded.height,
      })
      continue
    }

    const { width: pageWidth, height: pageHeight } = FIXED_PAGE_SIZES[options.pageSize]
    const page = pdf.addPage([pageWidth, pageHeight])
    const availableWidth = Math.max(pageWidth - PAGE_MARGIN * 2, 1)
    const availableHeight = Math.max(pageHeight - PAGE_MARGIN * 2, 1)
    // Fit inside the margin, never crop: an image is scaled down as a whole.
    const scale = Math.min(
      availableWidth / embedded.width,
      availableHeight / embedded.height,
    )
    const drawWidth = embedded.width * scale
    const drawHeight = embedded.height * scale
    page.drawImage(embedded, {
      x: (pageWidth - drawWidth) / 2,
      y: (pageHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    })
  }

  const bytes = await pdf.save()
  return { bytes, pageCount: pdf.getPageCount(), failed }
}
