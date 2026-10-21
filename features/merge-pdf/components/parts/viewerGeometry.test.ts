import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { clampZoom, computeViewerMetrics, MAX_CANVAS_PIXELS } from './viewerGeometry.ts'

/**
 * The viewer's fit + pixel math, pinned. Run with `npm run test:pdf-tools`.
 * Pure functions only — no DOM, no pdf.js.
 */

const base = {
  pageWidth: 600,
  pageHeight: 800,
  viewportWidth: 600,
  viewportHeight: 800,
  zoom: 1,
  dpr: 1,
} as const

test('a page that matches the stage fits exactly at zoom 1', () => {
  const m = computeViewerMetrics(base)
  assert.equal(m.displayScale, 1)
  assert.equal(Math.round(m.surfaceWidth), 600)
  assert.equal(Math.round(m.surfaceHeight), 800)
  assert.equal(m.renderScale, 1)
  assert.equal(m.pixelWidth, 600)
  assert.equal(m.pixelHeight, 800)
})

test('zoom scales the display surface and the render budget', () => {
  const m = computeViewerMetrics({ ...base, zoom: 2, dpr: 2 })
  assert.equal(m.displayScale, 2)
  assert.equal(Math.round(m.surfaceWidth), 1200)
  assert.equal(m.renderScale, 4)
  assert.equal(m.pixelWidth, 2400)
})

test('an output box preserves its proportion and the page is fitted into it', () => {
  // Same 3:4 page into a 3:4 box occupying a 2× stage: box = 600×800, page fills it.
  const m = computeViewerMetrics({ ...base, boxWidth: 300, boxHeight: 400 })
  assert.equal(Math.round(m.boxWidth), 600)
  assert.equal(Math.round(m.boxHeight), 800)
  assert.equal(m.displayScale, 1)
  assert.equal(Math.round(m.surfaceWidth), 600)
})

test('a page is letterboxed inside a mismatched output box', () => {
  // 600×800 page into a square 400×400 box that fits a 800×800 stage → box 800×800.
  const m = computeViewerMetrics({
    pageWidth: 600,
    pageHeight: 800,
    viewportWidth: 800,
    viewportHeight: 800,
    zoom: 1,
    dpr: 1,
    boxWidth: 400,
    boxHeight: 400,
  })
  assert.equal(Math.round(m.boxWidth), 800)
  assert.equal(Math.round(m.boxHeight), 800)
  // Contained by height: 800/800 = 1 → surface 600×800, narrower than the box.
  assert.equal(m.displayScale, 1)
  assert.equal(Math.round(m.surfaceHeight), 800)
  assert.ok(m.surfaceWidth < m.boxWidth)
})

test('the pixel budget clamps an enormous sheet', () => {
  const m = computeViewerMetrics({
    pageWidth: 100000,
    pageHeight: 100000,
    viewportWidth: 600,
    viewportHeight: 600,
    zoom: 6,
    dpr: 2,
  })
  assert.ok(m.pixelWidth * m.pixelHeight <= MAX_CANVAS_PIXELS)
  assert.ok(m.renderScale < 0.01 * 100)
})

test('clampZoom keeps the zoom inside the allowed range', () => {
  assert.equal(clampZoom(0), 0.25)
  assert.equal(clampZoom(99), 6)
  assert.equal(clampZoom(2), 2)
})
