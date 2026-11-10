import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { PDFDocument, PDFName } from 'pdf-lib'
import { splitPdf, SplitPdfValidationError } from './splitPdf.ts'

/**
 * Real round-trips through the split engine — same node:test + strip-types
 * setup as the pdf-editor suites. Run with `npm run test:pdf-tools`.
 */

async function makePdf(pages: number): Promise<File> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i += 1) doc.addPage([300, 200 + i])
  return new File([new Uint8Array(await doc.save())], 'report.pdf', { type: 'application/pdf' })
}

test('splitPdf produces one PDF per requested range, in order', async () => {
  const { parts, pageCount } = await splitPdf(await makePdf(6), '1-2, 4, 6-')

  assert.equal(pageCount, 6)
  assert.equal(parts.length, 3)
  assert.deepEqual(parts.map((p) => p.name), [
    'report_pages_1-2_part1.pdf',
    'report_pages_4-4_part2.pdf',
    'report_pages_6-6_part3.pdf',
  ])
  assert.equal((await PDFDocument.load(parts[0].bytes)).getPageCount(), 2)
  assert.equal((await PDFDocument.load(parts[1].bytes)).getPageCount(), 1)
  assert.equal((await PDFDocument.load(parts[2].bytes)).getPageCount(), 1)
})

test('a single range yields one plainly named part', async () => {
  const { parts } = await splitPdf(await makePdf(6), '3-5')
  assert.equal(parts.length, 1)
  assert.equal(parts[0].name, 'report_pages_3-5.pdf')
  assert.equal((await PDFDocument.load(parts[0].bytes)).getPageCount(), 3)
})

test('combine puts every requested page into one PDF, in the order given', async () => {
  const { parts } = await splitPdf(await makePdf(6), '5, 1-2, 4', { combine: true })
  assert.equal(parts.length, 1)
  assert.equal(parts[0].name, 'report_selected_pages.pdf')
  const out = await PDFDocument.load(parts[0].bytes)
  // makePdf gives page i the height 200 + (i - 1), so heights identify the source pages.
  assert.deepEqual(out.getPages().map((page) => page.getHeight()), [204, 200, 201, 203])
})

test('combine stays lean: linked pages left out are not dragged into the file', async () => {
  // A contents page whose links point at every other page. Without the
  // pageCopy preparation, copyPages follows each link's destination into its
  // page and that page's /Parent — the whole tree — so "pick 1 page" came out
  // the size of the source.
  const doc = await PDFDocument.create()
  const pages = Array.from({ length: 8 }, () => doc.addPage([300, 300]))
  const heavy = new Uint8Array(40_000).map((_, i) => (i * 7919) % 251)
  pages.slice(1).forEach((page) => {
    const stream = doc.context.flateStream(heavy)
    page.node.set(PDFName.of('Contents'), doc.context.register(stream))
  })
  const annots = pages.slice(1).map((target, i) => doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [10, 10 + i * 20, 200, 25 + i * 20],
    Dest: [target.ref, 'Fit'],
  })))
  pages[0].node.set(PDFName.of('Annots'), doc.context.obj(annots))
  const source = new File([new Uint8Array(await doc.save())], 'book.pdf', { type: 'application/pdf' })

  const whole = (await source.arrayBuffer()).byteLength
  const { parts } = await splitPdf(source, '1, 3', { combine: true })
  const out = await PDFDocument.load(parts[0].bytes)
  assert.equal(out.getPageCount(), 2)
  // Two of eight pages: far under the source, never a copy of all of it.
  assert.ok(parts[0].bytes.length < whole * 0.5, `${parts[0].bytes.length} vs source ${whole}`)
  // The link to the kept page 3 lands on the real output page; the rest go.
  const kept = out.getPage(0).node.Annots()
  assert.equal(kept?.size(), 1)
})

test('malformed ranges surface the stable parser codes', async () => {
  const file = await makePdf(2)
  await assert.rejects(splitPdf(file, ''), (error: unknown) => {
    assert.ok(error instanceof SplitPdfValidationError)
    assert.equal((error as SplitPdfValidationError).code, 'empty_range')
    return true
  })
  await assert.rejects(splitPdf(file, '9-'), (error: unknown) => {
    assert.ok(error instanceof SplitPdfValidationError)
    assert.equal((error as SplitPdfValidationError).code, 'invalid_range')
    return true
  })
})