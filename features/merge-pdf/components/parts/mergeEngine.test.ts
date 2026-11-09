import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  concatTransformationMatrix,
  degrees,
  drawObject,
  PDFDocument,
  PDFName,
  popGraphicsState,
  pushGraphicsState,
  StandardFonts,
} from 'pdf-lib'
import {
  MergeEngineError,
  mergeSheets,
  normalizeRotation,
  planFit,
  visibleBox,
  type MergeSheet,
  type MergeSource,
} from './mergeEngine.ts'

/**
 * Real pdf-lib round-trips through the browser merge engine.
 * Run with `npm run test:pdf-tools`.
 */

/** Deterministic, incompressible bytes — stands in for a real photo/font. */
function noise(length: number, seed: number) {
  const bytes = new Uint8Array(length)
  let state = seed >>> 0 || 1
  for (let i = 0; i < length; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    bytes[i] = state & 0xff
  }
  return bytes
}

/**
 * A document whose pages all draw the same heavy image — the common real
 * shape (logo/letterhead/embedded font shared by every page). Each page gets
 * a distinct width so the output order can be read back from page sizes.
 */
async function heavyPdf(widths: number[], seed: number, height = 400): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const side = 300
  const image = doc.context.flateStream(noise(side * side, seed), {
    Type: 'XObject',
    Subtype: 'Image',
    Width: side,
    Height: side,
    ColorSpace: 'DeviceGray',
    BitsPerComponent: 8,
  })
  const imageRef = doc.context.register(image)
  for (const width of widths) {
    const page = doc.addPage([width, height])
    const name = page.node.newXObject('Im', imageRef)
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(100, 0, 0, 100, 10, 10),
      drawObject(name),
      popGraphicsState(),
    )
  }
  return doc.save()
}

const widthsOf = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).getPages().map((page) => Math.round(page.getWidth()))

test('output follows the sheet order exactly, across documents', async () => {
  const a = await heavyPdf([301, 302, 303], 1)
  const b = await heavyPdf([401, 402], 2)
  const sources: MergeSource[] = [
    { key: 1, name: 'a.pdf', bytes: a },
    { key: 2, name: 'b.pdf', bytes: b },
  ]
  const sheets: MergeSheet[] = [
    { sourceKey: 2, pageNumber: 2, target: null },
    { sourceKey: 1, pageNumber: 1, target: null },
    { sourceKey: 2, pageNumber: 1, target: null },
    { sourceKey: 1, pageNumber: 3, target: null },
  ]
  assert.deepEqual(await widthsOf(await mergeSheets(sources, sheets)), [402, 301, 401, 303])
})

test('shared resources are written once: output ≈ sum of inputs, not pages × inputs', async () => {
  const a = await heavyPdf(Array.from({ length: 10 }, (_, i) => 300 + i), 3)
  const b = await heavyPdf(Array.from({ length: 10 }, (_, i) => 400 + i), 4)
  const sources: MergeSource[] = [
    { key: 'a', name: 'a.pdf', bytes: a },
    { key: 'b', name: 'b.pdf', bytes: b },
  ]
  const all = (key: string): MergeSheet[] =>
    Array.from({ length: 10 }, (_, i) => ({ sourceKey: key, pageNumber: i + 1, target: null }))
  const inputBytes = a.length + b.length

  const kept = await mergeSheets(sources, [...all('a'), ...all('b')])
  assert.ok(kept.length < inputBytes * 1.1, `kept size ${kept.length} vs inputs ${inputBytes}`)

  // Re-fitting every sheet to A4 must not duplicate the image either.
  const fitted = await mergeSheets(
    sources,
    [...all('a'), ...all('b')].map((sheet) => ({ ...sheet, target: [595.28, 841.89] as [number, number] })),
  )
  assert.ok(fitted.length < inputBytes * 1.1, `fitted size ${fitted.length} vs inputs ${inputBytes}`)
  assert.equal((await PDFDocument.load(fitted)).getPageCount(), 20)
})

test('pages are only re-fitted when their visible size differs', async () => {
  const a = await heavyPdf([300], 5, 400)
  const out = await PDFDocument.load(
    await mergeSheets(
      [{ key: 1, name: 'a.pdf', bytes: a }],
      [
        { sourceKey: 1, pageNumber: 1, target: [300, 400] },
        { sourceKey: 1, pageNumber: 1, target: [612, 792] },
      ],
    ),
  )
  const [same, letter] = out.getPages()
  assert.deepEqual(same.getSize(), { width: 300, height: 400 })
  assert.deepEqual(letter.getSize(), { width: 612, height: 792 })
  assert.deepEqual(letter.getCropBox(), { x: 0, y: 0, width: 612, height: 792 })
})

test('fit is centred and never crops, matching the preview letterbox', () => {
  const plan = planFit({ x: 0, y: 0, width: 300, height: 400 }, 0, [612, 792])!
  const [scale, , , , e, f] = plan.matrix
  assert.equal(scale, Math.min(612 / 300, 792 / 400))
  assert.ok(300 * scale <= 612 + 1e-9 && 400 * scale <= 792 + 1e-9)
  assert.ok(Math.abs(e - (612 - 300 * scale) / 2) < 1e-9)
  assert.ok(Math.abs(f - (792 - 400 * scale) / 2) < 1e-9)
})

test('rotated pages keep /Rotate and are fitted in their displayed orientation', async () => {
  const doc = await PDFDocument.create()
  doc.addPage([200, 300]).setRotation(degrees(90)) // displayed 300 × 200
  const bytes = await doc.save()
  const out = await PDFDocument.load(
    await mergeSheets(
      [{ key: 1, name: 'r.pdf', bytes }],
      [
        { sourceKey: 1, pageNumber: 1, target: [300, 200] },
        { sourceKey: 1, pageNumber: 1, target: [841.89, 595.28] },
      ],
    ),
  )
  const [untouched, landscape] = out.getPages()
  assert.equal(untouched.getRotation().angle, 90)
  assert.deepEqual(untouched.getSize(), { width: 200, height: 300 })
  assert.equal(landscape.getRotation().angle, 90)
  assert.deepEqual(landscape.getSize(), { width: 595.28, height: 841.89 })
})

test('a cropped page is fitted from its visible area, not its MediaBox', () => {
  const box = visibleBox({ x: 0, y: 0, width: 600, height: 800 }, { x: 50, y: 100, width: 500, height: 600 })
  assert.deepEqual(box, { x: 50, y: 100, width: 500, height: 600 })
  const plan = planFit(box, 0, [500, 600])
  assert.equal(plan, null)
  const moved = planFit(box, 0, [1000, 1200])!
  // Crop origin maps to the sheet origin after the 2× fit.
  assert.equal(moved.matrix[4], -100)
  assert.equal(moved.matrix[5], -200)
})

test('link annotations survive and follow a re-fitted page', async () => {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 400])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText('link', { x: 10, y: 10, size: 12, font })
  const link = doc.context.register(
    doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 100, 50], P: page.ref }),
  )
  page.node.addAnnot(link)
  const out = await PDFDocument.load(
    await mergeSheets(
      [{ key: 1, name: 'l.pdf', bytes: await doc.save() }],
      [{ sourceKey: 1, pageNumber: 1, target: [600, 800] }],
    ),
  )
  const annots = out.getPage(0).node.Annots()!
  assert.equal(annots.size(), 1)
  const rect = (annots.lookup(0) as import('pdf-lib').PDFDict).lookup(PDFName.of('Rect'))!.toString()
  assert.equal(rect.replace(/\s+/g, ' '), '[ 0 0 200 100 ]')
})

test('a damaged document fails the job with its name', async () => {
  await assert.rejects(
    mergeSheets(
      [{ key: 1, name: 'broken.pdf', bytes: new Uint8Array([1, 2, 3]) }],
      [{ sourceKey: 1, pageNumber: 1, target: null }],
    ),
    (error: unknown) =>
      error instanceof MergeEngineError && error.code === 'unreadable_pdf' && /broken\.pdf/.test(error.message),
  )
})

test('an out-of-range page and an empty job are refused, not skipped', async () => {
  const a = await heavyPdf([300], 6)
  await assert.rejects(
    mergeSheets([{ key: 1, name: 'a.pdf', bytes: a }], [{ sourceKey: 1, pageNumber: 2, target: null }]),
    (error: unknown) => error instanceof MergeEngineError && error.code === 'page_out_of_range',
  )
  await assert.rejects(
    mergeSheets([{ key: 1, name: 'a.pdf', bytes: a }], []),
    (error: unknown) => error instanceof MergeEngineError && error.code === 'no_pages',
  )
})

test('rotation is normalised to a quarter turn', () => {
  assert.equal(normalizeRotation(-90), 270)
  assert.equal(normalizeRotation(450), 90)
  assert.equal(normalizeRotation(Number.NaN), 0)
})
