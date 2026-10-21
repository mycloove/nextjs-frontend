import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { PDFDocument } from 'pdf-lib'
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