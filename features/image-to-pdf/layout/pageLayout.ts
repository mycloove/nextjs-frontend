/**
 * Images → PDF page geometry — the single source of truth for where each
 * image lands on which paper.
 *
 * Pure and dependency-free on purpose: the server engine
 * (`../server/imagesToPdf.ts`) uses it to build the PDF, and the browser
 * (`components/ImageToPDF.tsx`) uses the same functions to draw each tile, so
 * the page the user sees on the table is the page the engine emits (the
 * PDF editor's P = E rule, applied here). Colocated tests:
 * `pageLayout.test.ts` (`npm run test:image-to-pdf`).
 *
 * Units: PDF points (1 pt = 1/72 in) for pages, pixels for images.
 */

export type PageSizeOption = 'original' | 'a4' | 'letter'
export type OrientationOption = 'auto' | 'portrait' | 'landscape'
export type MarginOption = 'none' | 'small' | 'large'
export type QualityOption = 'high' | 'balanced' | 'small'

export const PAGE_SIZE_OPTIONS: readonly PageSizeOption[] = ['original', 'a4', 'letter']
export const ORIENTATION_OPTIONS: readonly OrientationOption[] = ['auto', 'portrait', 'landscape']
export const MARGIN_OPTIONS: readonly MarginOption[] = ['none', 'small', 'large']
export const QUALITY_OPTIONS: readonly QualityOption[] = ['high', 'balanced', 'small']

export interface LayoutOptions {
  pageSize: PageSizeOption
  orientation: OrientationOption
  margin: MarginOption
}

/** Defaults keep the tool's long-standing promise: one page per image, at its own shape. */
export const DEFAULT_LAYOUT: LayoutOptions = { pageSize: 'original', orientation: 'auto', margin: 'small' }
export const DEFAULT_QUALITY: QualityOption = 'balanced'

/* Portrait dimensions; landscape swaps them. */
export const FIXED_PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
} as const

/** Print margins in points: none, ~6.3 mm (the previous fixed margin), ~12.7 mm. */
export const MARGIN_POINTS: Record<MarginOption, number> = { none: 0, small: 18, large: 36 }

const POINTS_PER_INCH = 72

/*
 * "Original" page size. A pixel is not a physical unit, and the old engine
 * treated one pixel as one point — a 4000 × 3000 phone photo became a page
 * 1.4 m wide. A file's own DPI is only believed when it looks like a scanner
 * wrote it (≥ 150): phones and editors stamp a meaningless 72, and retina
 * screenshots say 144 for what is really a screen. Everything else is read
 * at screen density and then held to an A4-sized page, so a photo or
 * screenshot keeps its shape on paper a person can actually print.
 */
export const TRUSTED_DPI_MIN = 150
export const TRUSTED_DPI_MAX = 2400
export const SCREEN_DPI = 96
export const UNTRUSTED_MAX_LONG_SIDE = FIXED_PAGE_SIZES.a4.height
/** Largest page side PDF readers accept at the default user unit (200 in). */
export const PDF_MAX_SIDE = 14400

export interface PageBox {
  width: number
  height: number
}

export interface PagePlacement extends PageBox {
  /** Where the image is drawn, from the page's bottom-left corner (PDF space). */
  image: { x: number; y: number; width: number; height: number }
}

export function isTrustedDpi(density: number | undefined | null): density is number {
  return typeof density === 'number' && Number.isFinite(density) && density >= TRUSTED_DPI_MIN && density <= TRUSTED_DPI_MAX
}

/** Physical page for "Original": the image's own shape at a believable size. */
export function originalPageBox(pixelWidth: number, pixelHeight: number, density?: number | null): PageBox {
  const w = Math.max(1, pixelWidth)
  const h = Math.max(1, pixelHeight)
  if (isTrustedDpi(density)) {
    const width = (w * POINTS_PER_INCH) / density
    const height = (h * POINTS_PER_INCH) / density
    return clampLongSide({ width, height }, PDF_MAX_SIDE)
  }
  const width = (w * POINTS_PER_INCH) / SCREEN_DPI
  const height = (h * POINTS_PER_INCH) / SCREEN_DPI
  return clampLongSide({ width, height }, UNTRUSTED_MAX_LONG_SIDE)
}

function clampLongSide(box: PageBox, limit: number): PageBox {
  const long = Math.max(box.width, box.height)
  if (long <= limit) return box
  const scale = limit / long
  return { width: box.width * scale, height: box.height * scale }
}

/** A4 / Letter turned to suit the image ("auto") or as the user forced it. */
export function fixedPageBox(
  size: Exclude<PageSizeOption, 'original'>,
  orientation: OrientationOption,
  imageWidth: number,
  imageHeight: number,
): PageBox {
  const portrait = FIXED_PAGE_SIZES[size]
  const landscape =
    orientation === 'landscape' || (orientation === 'auto' && imageWidth > imageHeight)
  return landscape
    ? { width: portrait.height, height: portrait.width }
    : { width: portrait.width, height: portrait.height }
}

/**
 * The full placement for one image. "Original" pages are the image, edge to
 * edge. Fixed pages fit the whole image inside the margin, centred — scaled
 * as a whole, never cropped.
 */
export function placeImage(
  options: LayoutOptions,
  image: { width: number; height: number; density?: number | null },
): PagePlacement {
  const w = Math.max(1, image.width)
  const h = Math.max(1, image.height)

  if (options.pageSize === 'original') {
    const page = originalPageBox(w, h, image.density)
    return { ...page, image: { x: 0, y: 0, width: page.width, height: page.height } }
  }

  const page = fixedPageBox(options.pageSize, options.orientation, w, h)
  const margin = MARGIN_POINTS[options.margin]
  const availableWidth = Math.max(page.width - margin * 2, 1)
  const availableHeight = Math.max(page.height - margin * 2, 1)
  const scale = Math.min(availableWidth / w, availableHeight / h)
  const width = w * scale
  const height = h * scale
  return {
    ...page,
    image: { x: (page.width - width) / 2, y: (page.height - height) / 2, width, height },
  }
}

/** Millimetres, rounded for display ("210 × 297 mm"). */
export function pointsToMillimetres(points: number): number {
  return Math.round((points / POINTS_PER_INCH) * 25.4)
}

/* ── Encoding policy ────────────────────────────────────────────────────── */

export const JPEG_QUALITY: Record<QualityOption, number> = { high: 92, balanced: 82, small: 68 }

/**
 * Long-side pixel ceilings. 3508 px is A4 at 300 DPI — past it, print detail
 * stops improving while memory and bytes keep climbing. "Original" pages get a
 * little headroom (≈ A3 at 300 DPI). "Small" stops near 200 DPI on A4, which
 * is what makes it actually small.
 */
export function maxLongSide(pageSize: PageSizeOption, quality: QualityOption): number {
  if (quality === 'small') return pageSize === 'original' ? 2400 : 2339
  return pageSize === 'original' ? 4000 : 3508
}

/*
 * A screenshot, scan of text or diagram saved losslessly is ruined by JPEG
 * (ringing around every letter). Lossless sources stay lossless when that
 * costs at most this many times the JPEG's bytes. Measured on real files
 * (2026-11-11): a 2160×1350 app screenshot was 1.7× its JPEG; four real
 * photographs re-saved as PNG were 13–44×. "Small" never pays extra — its
 * promise is the smallest file.
 */
export const LOSSLESS_ALLOWANCE: Record<QualityOption, number> = { high: 4, balanced: 2.5, small: 1 }

export function preferLossless(losslessBytes: number, jpegBytes: number, quality: QualityOption): boolean {
  return losslessBytes <= jpegBytes * LOSSLESS_ALLOWANCE[quality]
}
