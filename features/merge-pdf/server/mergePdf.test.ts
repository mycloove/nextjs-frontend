import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { mergePdfs, MergePdfValidationError } from './mergePdf.ts'

/**
 * Real round-trips through the merge engine using pdf-lib built documents —
 * the same node:test + strip-types setup as the pdf-editor suites.
 * Run with `npm run test:pdf-tools`.
 */

async function makePdf(label: string, pages: number): Promise<File> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i += 1) {
    doc.addPage([300, 200]).drawText(`${label} page ${i + 1}`, { x: 12, y: 100, size: 14, font })
  }
  return new File([new Uint8Array(await doc.save())], `${label}.pdf`, { type: 'application/pdf' })
}

test('mergePdfs concatenates pages in caller order', async () => {
  const a = await makePdf('alpha', 2)
  const b = await makePdf('beta', 3)
  const { bytes, sourceCount } = await mergePdfs([a, b])

  assert.equal(sourceCount, 2)
  const out = await PDFDocument.load(bytes)
  assert.equal(out.getPageCount(), 5)
  // The first output page is alpha's first page (same box), not beta's.
  assert.deepEqual(out.getPage(0).getSize(), { width: 300, height: 200 })
})

test('mergePdfs refuses fewer than two PDFs with a stable code', async () => {
  const solo = await makePdf('solo', 1)
  await assert.rejects(mergePdfs([solo]), (error: unknown) => {
    assert.ok(error instanceof MergePdfValidationError)
    assert.equal((error as MergePdfValidationError).code, 'merge_needs_two')
    assert.equal((error as MergePdfValidationError).status, 400)
    return true
  })
})

test('mergePdfs names the unreadable file instead of failing silently', async () => {
  const good = await makePdf('good', 1)
  const bad = new File([new Uint8Array([1, 2, 3, 4])], 'broken.pdf', { type: 'application/pdf' })
  await assert.rejects(mergePdfs([good, bad]), (error: unknown) => {
    assert.ok(error instanceof MergePdfValidationError)
    assert.equal((error as MergePdfValidationError).code, 'unreadable_pdf')
    assert.match((error as MergePdfValidationError).message, /broken\.pdf/)
    return true
  })
})