import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FIXED_PAGE_SIZES,
  MARGIN_POINTS,
  PDF_MAX_SIDE,
  UNTRUSTED_MAX_LONG_SIDE,
  fixedPageBox,
  isTrustedDpi,
  maxLongSide,
  originalPageBox,
  placeImage,
  pointsToMillimetres,
  preferLossless,
  type LayoutOptions,
} from './pageLayout.ts'

const A4 = FIXED_PAGE_SIZES.a4
const close = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 0.01, `${message ?? ''} expected ${expected}, got ${actual}`)

const a4 = (orientation: LayoutOptions['orientation'] = 'auto', margin: LayoutOptions['margin'] = 'small'): LayoutOptions =>
  ({ pageSize: 'a4', orientation, margin })

test('auto turns A4 landscape for a landscape image and portrait otherwise', () => {
  assert.deepEqual(fixedPageBox('a4', 'auto', 4000, 3000), { width: A4.height, height: A4.width })
  assert.deepEqual(fixedPageBox('a4', 'auto', 3000, 4000), { width: A4.width, height: A4.height })
  // A square has no better side; portrait is the paper people expect.
  assert.deepEqual(fixedPageBox('a4', 'auto', 1000, 1000), { width: A4.width, height: A4.height })
})

test('a forced orientation wins over the image shape', () => {
  assert.deepEqual(fixedPageBox('letter', 'portrait', 4000, 3000), { width: 612, height: 792 })
  assert.deepEqual(fixedPageBox('letter', 'landscape', 3000, 4000), { width: 792, height: 612 })
})

test('a landscape photo fills an auto A4 page instead of a third of a portrait one', () => {
  const auto = placeImage(a4('auto'), { width: 4000, height: 3000 })
  const forcedPortrait = placeImage(a4('portrait'), { width: 4000, height: 3000 })
  const pageArea = (p: { width: number; height: number }) => p.width * p.height
  const autoShare = (auto.image.width * auto.image.height) / pageArea(auto)
  const portraitShare = (forcedPortrait.image.width * forcedPortrait.image.height) / pageArea(forcedPortrait)
  assert.ok(autoShare > 0.8, `auto share ${autoShare}`)
  assert.ok(portraitShare < 0.6, `portrait share ${portraitShare}`)
})

test('fixed pages fit the whole image inside the margin, centred, never cropped', () => {
  for (const margin of ['none', 'small', 'large'] as const) {
    const m = MARGIN_POINTS[margin]
    for (const [w, h] of [[4000, 3000], [3000, 4000], [500, 2000], [2000, 100], [10, 10]]) {
      const p = placeImage(a4('auto', margin), { width: w, height: h })
      assert.ok(p.image.width <= p.width - 2 * m + 0.001, `${w}x${h} ${margin} width`)
      assert.ok(p.image.height <= p.height - 2 * m + 0.001, `${w}x${h} ${margin} height`)
      close(p.image.x * 2 + p.image.width, p.width, 'centred horizontally')
      close(p.image.y * 2 + p.image.height, p.height, 'centred vertically')
      close(p.image.width / p.image.height, w / h, 'aspect kept')
      // It touches the margin on at least one axis: as large as it can be.
      const touches = Math.abs(p.image.width - (p.width - 2 * m)) < 0.01 || Math.abs(p.image.height - (p.height - 2 * m)) < 0.01
      assert.ok(touches, `${w}x${h} ${margin} should reach the margin`)
    }
  }
})

test('no margin means edge to edge on the fitting axis', () => {
  const p = placeImage(a4('portrait', 'none'), { width: 2100, height: 2970 })
  close(p.image.x, 0)
  close(p.image.width, A4.width)
})

test('original: a phone photo (72 dpi stamp) gets an A4-sized page, not a 1.4 m one', () => {
  const box = originalPageBox(4000, 3000, 72)
  close(Math.max(box.width, box.height), UNTRUSTED_MAX_LONG_SIDE)
  close(box.width / box.height, 4000 / 3000)
  assert.equal(pointsToMillimetres(box.width), 297)
})

test('original: a small screenshot keeps its on-screen size', () => {
  const box = originalPageBox(800, 600)
  close(box.width, 600)
  close(box.height, 450)
})

test('original: a retina screenshot (144 dpi) is not mistaken for a scan', () => {
  assert.equal(isTrustedDpi(144), false)
  const box = originalPageBox(2880, 1800, 144)
  close(Math.max(box.width, box.height), UNTRUSTED_MAX_LONG_SIDE)
})

test('original: a 300 dpi A4 scan comes back as A4', () => {
  const box = originalPageBox(2480, 3508, 300)
  assert.equal(pointsToMillimetres(box.width), 210)
  assert.equal(pointsToMillimetres(box.height), 297)
})

test('original: a trusted scan keeps its real size even when larger than A4', () => {
  const box = originalPageBox(3508, 4961, 300) // A3 at 300 dpi
  assert.equal(pointsToMillimetres(box.height), 420)
})

test('original: no page exceeds what PDF readers accept', () => {
  const box = originalPageBox(200000, 1000, 150)
  close(box.width, PDF_MAX_SIDE)
})

test('original pages are the image, edge to edge', () => {
  const p = placeImage({ pageSize: 'original', orientation: 'landscape', margin: 'large' }, { width: 1200, height: 900 })
  assert.deepEqual(p.image, { x: 0, y: 0, width: p.width, height: p.height })
})

test('unreadable dimensions never produce a zero-sized page', () => {
  const p = placeImage(a4(), { width: 0, height: 0 })
  assert.ok(p.width > 0 && p.height > 0 && p.image.width > 0 && p.image.height > 0)
})

test('Small has a lower pixel ceiling than High and Balanced', () => {
  assert.ok(maxLongSide('a4', 'small') < maxLongSide('a4', 'balanced'))
  assert.equal(maxLongSide('a4', 'high'), 3508)
  assert.equal(maxLongSide('original', 'balanced'), 4000)
})

test('lossless is kept only while it is not much bigger than JPEG', () => {
  assert.equal(preferLossless(100, 100, 'small'), true)
  assert.equal(preferLossless(101, 100, 'small'), false)
  assert.equal(preferLossless(250, 100, 'balanced'), true)
  assert.equal(preferLossless(251, 100, 'balanced'), false)
  assert.equal(preferLossless(400, 100, 'high'), true)
  assert.equal(preferLossless(401, 100, 'high'), false)
})
