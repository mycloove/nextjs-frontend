import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { isPdfFile, parsePageRanges, stripPdfExtension, PdfPageRangeError } from './pdfUtils.ts'

/**
 * Pure-function coverage for the shared structural-PDF helpers, ported from
 * the old 4-in-1 pdf-tools engine tests when the module split into four
 * focused tools. Run with `npm run test:pdf-tools`.
 */

test('parsePageRanges handles the documented spec shapes', () => {
  assert.deepEqual(parsePageRanges('1-3, 5, 8-', 10), [[1, 3], [5, 5], [8, 10]])
  assert.deepEqual(parsePageRanges('4', 10), [[4, 4]])
  assert.deepEqual(parsePageRanges('-3', 10), [[1, 3]])
  // Ranges are clamped to the document, never silently dropped.
  assert.deepEqual(parsePageRanges('9-20', 10), [[9, 10]])
})

test('parsePageRanges rejects malformed specs', () => {
  assert.throws(() => parsePageRanges('1;2', 10), PdfPageRangeError)
  assert.throws(() => parsePageRanges('5-2', 10), PdfPageRangeError)
  assert.throws(() => parsePageRanges('0', 10), PdfPageRangeError)
  assert.throws(() => parsePageRanges('', 10), PdfPageRangeError)
  assert.throws(() => parsePageRanges(',,', 10), PdfPageRangeError)
})

test('isPdfFile accepts MIME or extension, rejects others', () => {
  const pdf = new File([new Uint8Array([1])], 'doc.pdf', { type: 'application/pdf' })
  const extOnly = new File([new Uint8Array([1])], 'doc.PDF', { type: '' })
  const rogue = new File([new Uint8Array([1])], 'image.png', { type: 'image/png' })
  assert.equal(isPdfFile(pdf), true)
  assert.equal(isPdfFile(extOnly), true)
  assert.equal(isPdfFile(rogue), false)
})

test('validation errors carry stable codes for the route to map', () => {
  try {
    parsePageRanges('x', 10)
    assert.fail('expected throw')
  } catch (e) {
    assert.ok(e instanceof PdfPageRangeError)
    assert.equal((e as PdfPageRangeError).code, 'invalid_range')
    assert.equal((e as PdfPageRangeError).status, 400)
  }
})

test('stripPdfExtension keeps dotted names intact', () => {
  assert.equal(stripPdfExtension('Report 2024.pdf'), 'Report 2024')
  assert.equal(stripPdfExtension('my.final.v2.PDF'), 'my.final.v2')
  assert.equal(stripPdfExtension('.hidden'), '.hidden')
  assert.equal(stripPdfExtension('noext'), 'noext')
})