/**
 * Pure geometry for the page viewer.
 *
 * No DOM access — the render pipeline stays declarative and this math is
 * unit-testable (viewerGeometry.test.ts, run by `npm run test:pdf-tools`).
 *
 * Two scales are in play:
 *   displayScale — CSS px per PDF point (what the text layer and the surface use)
 *   renderScale  — bitmap px per PDF point (displayScale × DPR, clamped to a
 *                  pixel budget so a large sheet at high zoom cannot OOM)
 */

/** Hard ceiling on a single canvas' backing store (~A2 at ~200 DPI). */
export const MAX_CANVAS_PIXELS = 16_000_000

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 6

export interface ViewerMetricsInput {
  pageWidth: number
  pageHeight: number
  viewportWidth: number
  viewportHeight: number
  zoom: number
  dpr: number
  /** Optional output box (merge). When given, the page is fitted inside it. */
  boxWidth?: number
  boxHeight?: number
}

export interface ViewerMetrics {
  boxWidth: number
  boxHeight: number
  surfaceWidth: number
  surfaceHeight: number
  displayScale: number
  renderScale: number
  pixelWidth: number
  pixelHeight: number
}

export function clampZoom(zoom: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
  return Math.min(max, Math.max(min, zoom))
}

export function computeViewerMetrics(input: ViewerMetricsInput): ViewerMetrics {
  const pageWidth = Math.max(1, input.pageWidth)
  const pageHeight = Math.max(1, input.pageHeight)
  const viewportWidth = Math.max(1, input.viewportWidth)
  const viewportHeight = Math.max(1, input.viewportHeight)
  const zoom = clampZoom(input.zoom)
  const dpr = Math.max(1, input.dpr)

  /* The output box (when present) is itself fitted into the stage, preserving
     the exported page proportion. Otherwise the stage is the box. */
  let fittedBoxWidth = viewportWidth
  let fittedBoxHeight = viewportHeight
  if (input.boxWidth && input.boxHeight && input.boxWidth > 0 && input.boxHeight > 0) {
    const boxScale = Math.min(viewportWidth / input.boxWidth, viewportHeight / input.boxHeight)
    fittedBoxWidth = input.boxWidth * boxScale
    fittedBoxHeight = input.boxHeight * boxScale
  }

  const fitScale = Math.min(fittedBoxWidth / pageWidth, fittedBoxHeight / pageHeight)
  const displayScale = fitScale * zoom
  const surfaceWidth = pageWidth * displayScale
  const surfaceHeight = pageHeight * displayScale

  /* The paper frame never clips the sheet: once zoom pushes the page past the
     fitted box, the box grows with it so the white margin can never be left
     behind — the border always hugs whatever the sheet has become. */
  const boxWidth = Math.max(fittedBoxWidth, surfaceWidth)
  const boxHeight = Math.max(fittedBoxHeight, surfaceHeight)

  const desiredRender = displayScale * dpr
  const maxRender = Math.sqrt(MAX_CANVAS_PIXELS / (pageWidth * pageHeight))
  const renderScale = Math.max(0.01, Math.min(desiredRender, maxRender))

  return {
    boxWidth,
    boxHeight,
    surfaceWidth,
    surfaceHeight,
    displayScale,
    renderScale,
    pixelWidth: Math.max(1, Math.round(pageWidth * renderScale)),
    pixelHeight: Math.max(1, Math.round(pageHeight * renderScale)),
  }
}
