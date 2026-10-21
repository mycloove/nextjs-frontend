import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { compressPdf, CompressPdfValidationError } from './compressPdf.ts'

/**
 * Real round-trips through the compress engine — same node:test + strip-types
 * setup as the pdf-editor suites. Run with `npm run test:pdf-tools`.
 */

async function makePdf(): Promise<File> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.setTitle('Metadata keeper')
  doc.setAuthor('mycloove test suite')
  doc.addPage([300, 200]).drawText('compress me', { x: 12, y: 100, size: 14, font })
  return new File([new Uint8Array(await doc.save())], 'keeper.pdf', { type: 'application/pdf' })
}

test('light compression keeps metadata and every page', async () => {
  const file = await makePdf()
  const { bytes, originalBytes } = await compressPdf(file, 'light')

  assert.equal(originalBytes, file.size)
  const out = await PDFDocument.load(bytes)
  assert.equal(out.getTitle(), 'Metadata keeper')
  assert.equal(out.getPageCount(), 1)
})

test('strong compression drops metadata but keeps the document', async () => {
  const file = await makePdf()
  const { bytes } = await compressPdf(file, 'strong')

  const out = await PDFDocument.load(bytes)
  assert.equal(out.getTitle(), '')
  assert.equal(out.getAuthor(), '')
  assert.equal(out.getPageCount(), 1)
})

test('aggressive compression drops metadata and still opens cleanly', async () => {
  const file = await makePdf()
  const { bytes } = await compressPdf(file, 'aggressive')

  const out = await PDFDocument.load(bytes)
  assert.equal(out.getTitle(), '')
  assert.equal(out.getPageCount(), 1)
})

test('invalid levels carry a stable code', async () => {
  const file = await makePdf()
  await assert.rejects(compressPdf(file, 'extreme' as 'light'), (error: unknown) => {
    assert.ok(error instanceof CompressPdfValidationError)
    assert.equal((error as CompressPdfValidationError).code, 'invalid_level')
    return true
  })
})