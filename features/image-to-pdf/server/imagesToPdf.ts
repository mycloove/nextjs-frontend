import sharp from 'sharp'
import {
  concatTransformationMatrix,
  drawObject,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
} from 'pdf-lib'
import {
  DEFAULT_LAYOUT,
  JPEG_QUALITY,
  maxLongSide,
  placeImage,
  preferLossless,
  type LayoutOptions,
  type MarginOption,
  type OrientationOption,
  type PageSizeOption,
  type QualityOption,
} from '../layout/pageLayout.ts'

/**
 * Image → PDF conversion engine (server-only).
 *
 * This is the module's own logic, kept out of `app/api/image-to-pdf/route.ts`
 * so that route stays a thin validating handler (CLAUDE.md §5/§6). Only the
 * route imports this file; it is never re-exported from the `'use client'`
 * shim in `features/image-to-pdf/index.tsx`. Page geometry lives in
 * `../layout/pageLayout.ts`, which the browser also uses to draw the table —
 * so the preview and this engine cannot disagree about a page.
 *
 * What each image goes through, and why:
 *
 *   1. Decode + orient. EXIF rotation is applied for real; alpha is flattened
 *      onto white (a PDF page is white, so transparency is not observable).
 *   2. Bound. The long side is capped (≈ 300 DPI on the page, lower for
 *      "Small"); nothing is ever enlarged.
 *   3. Encode — the step the old engine got wrong for half its inputs:
 *      - an upright JPEG within the ceiling is embedded byte-for-byte (no
 *        generation loss), except under "Small", where it is re-encoded and
 *        kept only if that is actually smaller;
 *      - a lossless source (PNG, GIF, TIFF — screenshots, scans of text,
 *        diagrams) stays lossless (Flate) unless it is really a photograph,
 *        judged by comparing its lossless size with its JPEG size
 *        (`preferLossless`). Every PNG used to become a JPEG, which smeared
 *        every letter of every screenshot;
 *      - everything else becomes a JPEG at the chosen quality.
 *   4. Place. `placeImage` decides the paper: "Original" now has a physical
 *      size (it used to be one point per pixel — a phone photo became a page
 *      1.4 m wide), and A4/Letter turn landscape for landscape images instead
 *      of shrinking them onto a portrait sheet.
 *
 * Images decode in bounded parallel; embedding is sequential because
 * `pdf-lib` is not concurrency-safe. An image that cannot be decoded is
 * skipped and named in `failed`, so one bad file never sinks a document.
 * Colocated tests: `imagesToPdf.test.ts` (`npm run test:image-to-pdf`).
 */

export type { MarginOption, OrientationOption, PageSizeOption, QualityOption }

export interface ConversionOptions {
  pageSize: PageSizeOption
  quality: QualityOption
  /** Defaults to `auto` — only meaningful for A4/Letter. */
  orientation?: OrientationOption
  /** Defaults to `small` (the margin this tool always used) — only for A4/Letter. */
  margin?: MarginOption
}

/** How each page's image was stored — reported back so the receipt can say it. */
export interface EncodingCounts {
  /** An upright JPEG embedded byte-for-byte. */
  original: number
  /** Re-encoded as JPEG at the chosen quality. */
  jpeg: number
  /** Stored losslessly (Flate) — pixel-exact. */
  lossless: number
}

export interface ConversionResult {
  bytes: Uint8Array
  pageCount: number
  /** Names of inputs that could not be decoded. The job still succeeds if any page was produced. */
  failed: string[]
  encodings: EncodingCounts
}

/** Caller-fixable problem; the route maps it to a stable status/code. */
export class ImagesToPdfValidationError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, code: string, status = 400) {
    super(message)
    this.name = 'ImagesToPdfValidationError'
    this.code = code
    this.status = status
  }
}

/** sharp is CPU-bound; beyond a few in flight the wins flatten and RAM spikes. */
const CONCURRENCY = 4

/*
 * Raster formats this engine reads. SVG is refused on purpose: it is a
 * document, not a picture of one, and rendering it server-side is a different
 * job with different risks. BMP is not readable by sharp's libvips build — the
 * browser converts BMP to PNG before upload (components/ImageToPDF.tsx).
 */
const READABLE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'tiff', 'heif'])
const LOSSLESS_SOURCE_FORMATS = new Set(['png', 'gif', 'tiff'])

type Encoding = keyof EncodingCounts

interface PreparedImage {
  encoding: Encoding
  /** JPEG bytes, or a PNG's IDAT stream (Flate, `/Predictor 15`) for `lossless`. */
  data: Uint8Array
  pixelWidth: number
  pixelHeight: number
  /** Lossless only: 1 = gray, 3 = RGB. */
  channels: 1 | 3
  /** Upright source pixels and the file's own DPI — what decides the paper. */
  sourceWidth: number
  sourceHeight: number
  density?: number
}

function isGrayscale(metadata: sharp.Metadata): boolean {
  return metadata.space === 'b-w' || metadata.channels === 1 || metadata.channels === 2
}

/** True when every RGB pixel has R = G = B (stops at the first coloured one). */
function isNeutral(rgb: Buffer): boolean {
  for (let i = 0; i < rgb.length; i += 3) {
    if (rgb[i] !== rgb[i + 1] || rgb[i] !== rgb[i + 2]) return false
  }
  return true
}

function toGray(rgb: Buffer): Buffer {
  const gray = Buffer.allocUnsafe(rgb.length / 3)
  for (let i = 0, j = 0; i < rgb.length; i += 3, j++) gray[j] = rgb[i]
  return gray
}

/*
 * A PNG's IDAT data is already a valid PDF Flate stream: zlib-compressed rows,
 * each prefixed with its PNG filter byte, which PDF decodes with
 * `/Predictor 15`. Reusing it keeps PNG's row filters — plain deflate of raw
 * pixels is several times larger on screenshots, large enough to lose to
 * JPEG and smear the text again. Only the simple case is accepted (8-bit gray
 * or RGB, not interlaced), which is exactly what this engine asks sharp for.
 */
function pngImageStream(png: Buffer): { data: Buffer; channels: 1 | 3 } | null {
  let offset = 8 // PNG signature
  let channels: 1 | 3 | null = null
  const parts: Buffer[] = []
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('latin1', offset + 4, offset + 8)
    const start = offset + 8
    if (start + length > png.length) return null
    if (type === 'IHDR') {
      const bitDepth = png[start + 8]
      const colourType = png[start + 9]
      const interlace = png[start + 12]
      // The colour space written into the PDF comes from here, never from
      // what was asked of sharp — a mismatch would draw garbage.
      if (bitDepth === 8 && interlace === 0) channels = colourType === 0 ? 1 : colourType === 2 ? 3 : null
    } else if (type === 'IDAT') {
      parts.push(png.subarray(start, start + length))
    } else if (type === 'IEND') {
      break
    }
    offset = start + length + 4 // + CRC
  }
  return channels && parts.length ? { data: Buffer.concat(parts), channels } : null
}

async function prepareImage(file: File, options: Required<ConversionOptions>): Promise<PreparedImage> {
  const input = Buffer.from(await file.arrayBuffer())
  const metadata = await sharp(input, { failOn: 'none' }).metadata()
  if (!metadata.format || !READABLE_FORMATS.has(metadata.format)) {
    throw new Error(`Unsupported image format: ${metadata.format ?? 'unknown'}`)
  }
  if (!metadata.width || !metadata.height) throw new Error('Image has no dimensions')

  const orientation = metadata.orientation ?? 1
  // EXIF orientations 5–8 turn the image a quarter, swapping its sides.
  const sideways = orientation >= 5
  const sourceWidth = sideways ? metadata.height : metadata.width
  const sourceHeight = sideways ? metadata.width : metadata.height
  const source = { sourceWidth, sourceHeight, density: metadata.density }
  const limit = maxLongSide(options.pageSize, options.quality)
  const oversized = Math.max(sourceWidth, sourceHeight) > limit

  const untouched: PreparedImage = {
    ...source,
    encoding: 'original',
    data: input,
    pixelWidth: sourceWidth,
    pixelHeight: sourceHeight,
    channels: 3,
  }
  const canPassThrough =
    metadata.format === 'jpeg' && orientation === 1 && !metadata.hasAlpha && !oversized
  if (canPassThrough && options.quality !== 'small') return untouched

  const pipeline = () => {
    let image = sharp(input, { failOn: 'none' }).rotate()
    if (oversized) {
      image = image.resize({ width: limit, height: limit, fit: 'inside', withoutEnlargement: true })
    }
    if (metadata.hasAlpha) image = image.flatten({ background: '#ffffff' })
    return image
  }

  const jpeg = await pipeline()
    .jpeg({ quality: JPEG_QUALITY[options.quality], mozjpeg: true })
    .toBuffer({ resolveWithObject: true })

  // "Small" promised fewer bytes; a re-encode that is not smaller breaks it.
  if (canPassThrough && input.length <= jpeg.data.length) return untouched

  if (LOSSLESS_SOURCE_FORMATS.has(metadata.format)) {
    const gray = isGrayscale(metadata)
    const raw = await pipeline()
      .toColourspace(gray ? 'b-w' : 'srgb')
      .removeAlpha()
      .raw({ depth: 'uchar' })
      .toBuffer({ resolveWithObject: true })
    const { width, height } = raw.info
    // Scans and black-and-white screenshots are often saved as RGB with
    // R = G = B everywhere; storing them as gray is a third of the bytes.
    const pixels = raw.info.channels === 3 && isNeutral(raw.data) ? toGray(raw.data) : raw.data
    const channels = pixels === raw.data ? raw.info.channels : 1
    if (channels === 1 || channels === 3) {
      // No adaptive filtering: on flat, few-colour images (the ones worth
      // keeping lossless) it measured ~30% smaller than adaptive filtering.
      // One-channel input must be declared b-w, or sharp writes an RGB PNG.
      const png = await sharp(pixels, { raw: { width, height, channels } })
        .toColourspace(channels === 1 ? 'b-w' : 'srgb')
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toBuffer()
      const stream = pngImageStream(png)
      if (stream && preferLossless(stream.data.length, jpeg.data.length, options.quality)) {
        return {
          ...source,
          encoding: 'lossless',
          data: stream.data,
          pixelWidth: width,
          pixelHeight: height,
          channels: stream.channels,
        }
      }
    }
  }

  return {
    ...source,
    encoding: 'jpeg',
    data: jpeg.data,
    pixelWidth: jpeg.info.width,
    pixelHeight: jpeg.info.height,
    channels: 3,
  }
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
 * decoded is skipped and named in `failed`; only an all-failed job throws.
 */
export async function convertImagesToPdf(
  files: File[],
  options: ConversionOptions,
): Promise<ConversionResult> {
  const settings: Required<ConversionOptions> = {
    pageSize: options.pageSize,
    quality: options.quality,
    orientation: options.orientation ?? DEFAULT_LAYOUT.orientation,
    margin: options.margin ?? DEFAULT_LAYOUT.margin,
  }
  const layout: LayoutOptions = {
    pageSize: settings.pageSize,
    orientation: settings.orientation,
    margin: settings.margin,
  }

  const prepared = await mapWithConcurrency(files, CONCURRENCY, async (file) => {
    try {
      return { name: file.name, image: await prepareImage(file, settings) }
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
      files.length === 1
        ? 'This image could not be read — it may be damaged or in a format this tool does not support'
        : 'None of these images could be read — they may be damaged or in a format this tool does not support',
      'no_valid_images',
    )
  }

  const pdf = await PDFDocument.create()
  const title = usable[0].name.replace(/\.[^.]+$/, '').trim()
  if (title) pdf.setTitle(title)
  pdf.setCreator('mycloove — Images to PDF')
  pdf.setProducer('mycloove')

  const encodings: EncodingCounts = { original: 0, jpeg: 0, lossless: 0 }

  for (const { image } of usable) {
    const placement = placeImage(layout, {
      width: image.sourceWidth,
      height: image.sourceHeight,
      density: image.density,
    })
    const page = pdf.addPage([placement.width, placement.height])
    const { x, y, width, height } = placement.image

    if (image.encoding === 'lossless') {
      // pdf-lib's own PNG path would decode the PNG in JavaScript and deflate
      // it again without row filters; the PNG's own stream goes in as it is.
      const ref = pdf.context.register(
        pdf.context.stream(image.data, {
          Type: 'XObject',
          Subtype: 'Image',
          Width: image.pixelWidth,
          Height: image.pixelHeight,
          ColorSpace: image.channels === 1 ? 'DeviceGray' : 'DeviceRGB',
          BitsPerComponent: 8,
          Filter: 'FlateDecode',
          DecodeParms: { Predictor: 15, Colors: image.channels, BitsPerComponent: 8, Columns: image.pixelWidth },
        }),
      )
      const name = page.node.newXObject('Image', ref)
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(width, 0, 0, height, x, y),
        drawObject(name),
        popGraphicsState(),
      )
    } else {
      const embedded = await pdf.embedJpg(image.data)
      page.drawImage(embedded, { x, y, width, height })
    }
    encodings[image.encoding] += 1
  }

  const bytes = await pdf.save()
  return { bytes, pageCount: pdf.getPageCount(), failed, encodings }
}
