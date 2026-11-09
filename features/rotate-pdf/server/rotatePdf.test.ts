import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName } from 'pdf-lib'
import { parseRotatePdfPagePlan, rotatePdf, rotatePdfPagePlan, RotatePdfValidationError } from './rotatePdf.ts'

/**
 * Real round-trips through the rotate engine — same node:test + strip-types
 * setup as the pdf-editor suites. Run with `npm run test:pdf-tools`.
 */

async function makePdf(pages: number): Promise<File> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i += 1) doc.addPage([300, 200])
  return new File([new Uint8Array(await doc.save())], 'report.pdf', { type: 'application/pdf' })
}

test('rotatePdf turns every page when the range is empty', async () => {
  const { bytes, rotated } = await rotatePdf(await makePdf(2), 90, '')
  assert.equal(rotated, 2)
  const out = await PDFDocument.load(bytes)
  for (const page of out.getPages()) assert.equal(page.getRotation().angle, 90)
})

test('rotatePdf turns only the requested pages', async () => {
  const { bytes, rotated } = await rotatePdf(await makePdf(2), 180, '1')
  assert.equal(rotated, 1)
  const out = await PDFDocument.load(bytes)
  assert.equal(out.getPage(0).getRotation().angle, 180)
  assert.equal(out.getPage(1).getRotation().angle, 0)
})

test('angles are restricted to quarter-turns with a stable code', async () => {
  const file = await makePdf(1)
  await assert.rejects(rotatePdf(file, 45, ''), (error: unknown) => {
    assert.ok(error instanceof RotatePdfValidationError)
    assert.equal((error as RotatePdfValidationError).code, 'invalid_angle')
    return true
  })
})

test('malformed ranges surface the stable parser codes', async () => {
  const file = await makePdf(2)
  await assert.rejects(rotatePdf(file, 90, 'x'), (error: unknown) => {
    assert.ok(error instanceof RotatePdfValidationError)
    assert.equal((error as RotatePdfValidationError).code, 'invalid_range')
    return true
  })
})

test('page plan reorders sheets and keeps their individual rotations', async () => {
  const source = await PDFDocument.create()
  source.addPage([300, 200])
  source.addPage([400, 200])
  source.addPage([500, 200])
  const file = new File([new Uint8Array(await source.save())], 'report.pdf', { type: 'application/pdf' })
  const { bytes, rotated } = await rotatePdfPagePlan(file, [
    { originalIndex: 2, rotation: 90 },
    { originalIndex: 0, rotation: 0 },
    { originalIndex: 1, rotation: 270 },
  ])
  assert.equal(rotated, 2)
  const out = await PDFDocument.load(bytes)
  assert.equal(out.getPageCount(), 3)
  assert.equal(out.getPage(0).getWidth(), 500)
  assert.equal(out.getPage(1).getWidth(), 300)
  assert.equal(out.getPage(2).getWidth(), 400)
  assert.equal(out.getPage(0).getRotation().angle, 90)
  assert.equal(out.getPage(1).getRotation().angle, 0)
  assert.equal(out.getPage(2).getRotation().angle, 270)
})

test('page plan reorders in place: bookmarks, form fields, metadata and inherited attributes survive', async () => {
  const source = await PDFDocument.create()
  source.setTitle('Q3 Report')
  for (const width of [300, 400, 500]) source.addPage([width, 200])
  // Page 2 inherits its MediaBox from the page tree, as real producers do.
  const tree = source.catalog.Pages()
  tree.set(PDFName.of('MediaBox'), source.context.obj([0, 0, 612, 792]))
  source.getPage(1).node.delete(PDFName.of('MediaBox'))
  // A bookmark onto the third page, and a filled form field on the first.
  const ctx = source.context
  const outlinesRef = ctx.nextRef()
  const itemRef = ctx.nextRef()
  ctx.assign(itemRef, ctx.obj({
    Title: PDFHexString.fromText('Chapter 3'),
    Parent: outlinesRef,
    Dest: [source.getPage(2).ref, 'Fit'],
  }))
  ctx.assign(outlinesRef, ctx.obj({ Type: 'Outlines', First: itemRef, Last: itemRef, Count: 1 }))
  source.catalog.set(PDFName.of('Outlines'), outlinesRef)
  const field = source.getForm().createTextField('approver')
  field.setText('Rahim')
  field.addToPage(source.getPage(0), { x: 10, y: 10, width: 120, height: 20 })
  const file = new File([new Uint8Array(await source.save())], 'report.pdf', { type: 'application/pdf' })

  const { bytes } = await rotatePdfPagePlan(file, [
    { originalIndex: 2, rotation: 90 },
    { originalIndex: 1, rotation: 0 },
    { originalIndex: 0, rotation: 0 },
  ])
  const out = await PDFDocument.load(bytes)

  assert.equal(out.getTitle(), 'Q3 Report')
  assert.equal(out.getForm().getTextField('approver').getText(), 'Rahim')
  assert.deepEqual(out.getPages().map((page) => page.getWidth()), [500, 612, 300])

  // The bookmark still lands on the real (now first) page, not a copy of it.
  const outlines = out.catalog.lookup(PDFName.of('Outlines'), PDFDict)
  const item = outlines.lookup(PDFName.of('First'), PDFDict)
  const dest = item.lookup(PDFName.of('Dest'), PDFArray)
  assert.equal(dest.get(0), out.getPage(0).ref)

  // No invisible duplicate pages hiding in the file.
  const pageObjects = out.context.enumerateIndirectObjects().filter(([, object]) =>
    object instanceof PDFDict && object.get(PDFName.of('Type')) === PDFName.of('Page'))
  assert.equal(pageObjects.length, 3)
})

test('page plan rejects duplicate source pages with a stable code', async () => {
  await assert.rejects(rotatePdfPagePlan(await makePdf(2), [
    { originalIndex: 0, rotation: 0 },
    { originalIndex: 0, rotation: 90 },
  ]), (error: unknown) => {
    assert.ok(error instanceof RotatePdfValidationError)
    assert.equal((error as RotatePdfValidationError).code, 'invalid_page_plan')
    return true
  })
})

test('malformed page plan input carries a stable code', () => {
  assert.throws(() => parseRotatePdfPagePlan('{'), (error: unknown) => {
    assert.ok(error instanceof RotatePdfValidationError)
    assert.equal((error as RotatePdfValidationError).code, 'invalid_page_plan')
    return true
  })
})
