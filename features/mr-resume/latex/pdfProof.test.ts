import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { copyProofBytes, extractProofText, pdfProofIdentity, PROOF_DOCUMENT_PIXELS, PROOF_LOCATE_LIMIT, PROOF_TEXT_LIMITS, proofBitmapSize, proofDocumentBitmapSize, proofPoint, proofScrollPosition, proofSourceBox, proofTextPoint } from './pdfProof.ts'
import { LATEX_LIMITS } from './types.ts'

test('renderer transfer never consumes or changes canonical download bytes', () => {
  const original = new TextEncoder().encode('%PDF-1.7\nproof bytes\n%%EOF').buffer
  const before = new Uint8Array(original).slice()
  const rendered = copyProofBytes(original, original.byteLength)
  assert.notEqual(rendered.buffer, original)
  structuredClone(rendered, { transfer: [rendered.buffer] })
  assert.equal(rendered.byteLength, 0)
  assert.deepEqual(new Uint8Array(original), before)
})

test('missing, mismatched and oversized artifacts are not presented as PDF proofs', () => {
  assert.throws(() => copyProofBytes(new ArrayBuffer(10), 10))
  const data = new TextEncoder().encode('%PDF-1.7').buffer
  assert.throws(() => copyProofBytes(data, 100))
  assert.throws(() => copyProofBytes(new ArrayBuffer(4 * 1024 * 1024), 4 * 1024 * 1024))
})

test('page rasterization has a real dimension, memory and density budget', () => {
  assert.deepEqual(proofBitmapSize(600, 800, 3), { width: 1200, height: 1600, density: 2 })
  for (const [width, height, density] of [[NaN, 10, 1], [100, Infinity, 1], [-1, 10, 1], [1000000, 10, 1], [8000, 8000, 1], [10, 10, 0]]) assert.throws(() => proofBitmapSize(width, height, density))
})

const viewport = {
  width: 200, height: 300,
  convertToViewportRectangle: ([x1, y1, x2, y2]: number[]) => [x1 * 2, 300 - y1 * 2, x2 * 2, 300 - y2 * 2],
  convertToPdfPoint: (x: number, y: number) => [x / 2, (300 - y) / 2],
}

test('measured SyncTeX boxes use the PDF viewport transform, with no guessed positions', () => {
  assert.deepEqual(proofSourceBox({ page: 1, x: 10, y: 20, width: 30, height: 10 }, viewport), { left: 20, top: 240, width: 60, height: 20 })
  assert.equal(proofSourceBox({ page: 1, x: 10, y: 20, width: 0, height: 10 }, viewport), null)
  assert.equal(proofSourceBox({ page: 1, x: 1000, y: 1000, width: 10, height: 10 }, viewport), null)
})

test('inverse navigation converts actual scaled pointer coordinates back into PDF points', () => {
  const bounds = { left: 30, top: 40, width: 400, height: 600 }
  assert.deepEqual(proofPoint(70, 100, bounds, viewport), { x: 10, y: 135 })
  assert.equal(proofPoint(0, 0, bounds, viewport), null)
  assert.equal(proofPoint(70, 100, { ...bounds, width: 0 }, viewport), null)
})

test('continuous preview retains all pages within one bitmap budget, including high-DPI and 200% zoom', () => {
  for (const pages of [1, 2, 8, 16, LATEX_LIMITS.pages]) for (const ratio of [0.75, 1, 2, 3]) {
    let pixels = 0
    for (let index = 0; index < pages; index++) {
      const width = index % 2 ? 1683.78 : 1190.56, height = index % 2 ? 1190.56 : 1683.78
      const size = proofDocumentBitmapSize(width, height, ratio, pages)
      pixels += size.width * size.height
      assert.ok(size.width > 0 && size.height > 0 && size.density > 0 && size.density <= Math.min(2, ratio))
      assert.ok(width * size.density <= size.width && height * size.density <= size.height)
    }
    assert.ok(pixels <= PROOF_DOCUMENT_PIXELS, `${pages} pages at DPR ${ratio}: ${pixels}`)
  }
  assert.deepEqual(proofDocumentBitmapSize(600, 800, 2, 2), proofBitmapSize(600, 800, 2), 'Normal two-page resumes retain full preview density')
  for (const pages of [0, -1, 1.5, LATEX_LIMITS.pages + 1, NaN]) assert.throws(() => proofDocumentBitmapSize(600, 800, 2, pages))
  assert.throws(() => proofDocumentBitmapSize(1000000, 10, 1, 2))
})

test('measured navigation scrolls only the PDF viewport and does not move already-visible targets', () => {
  const viewport = { left: 300, top: 200, width: 500, height: 600 }
  assert.deepEqual(proofScrollPosition(viewport, { left: 400, top: 300, width: 20, height: 24 }, 800, 0), { top: 800, left: 0 })
  assert.deepEqual(proofScrollPosition(viewport, { left: 900, top: 1400, width: 20, height: 24 }, 800, 50), { top: 1984, left: 634 })
  assert.deepEqual(proofScrollPosition(viewport, { left: -20, top: -20, width: 20, height: 24 }, 0, 0), { top: 0, left: 0 })
  assert.equal(proofScrollPosition(viewport, { left: NaN, top: 300, width: 20, height: 24 }, 800, 0), null)
  assert.equal(proofScrollPosition(viewport, { left: 400, top: 300, width: 0, height: 24 }, 800, 0), null)
})

test('selected PDF text uses one measured fragment, not a multi-line or multi-column union', () => {
  const bounds = { left: 30, top: 40, width: 400, height: 600 }
  const first = { left: 70, top: 100, width: 40, height: 20 }, second = { left: 310, top: 300, width: 80, height: 20 }
  assert.deepEqual(proofTextPoint([first, second], bounds, viewport), { x: 15, y: 132.5 })
  assert.deepEqual(proofTextPoint([first], bounds, viewport), proofTextPoint([first, second], bounds, viewport), 'A focused text item and the same selected fragment query the same PDF point')
  assert.notDeepEqual(proofTextPoint([first, second], bounds, viewport), proofPoint(230, 210, bounds, viewport), 'The blank space between selected columns is not the target')
})

test('text geometry clips to the actual PDF rectangle and refuses empty or off-page selections', () => {
  const bounds = { left: 30, top: 40, width: 400, height: 600 }
  const partial = { left: 10, top: 100, width: 40, height: 20 }
  assert.deepEqual(proofTextPoint([partial], bounds, viewport), { x: 2.5, y: 132.5 })
  const rejected = [
    { left: 70, top: 100, width: 0, height: 20 }, { left: 70, top: 100, width: 40, height: 0 },
    { left: 70, top: 100, width: -40, height: 20 }, { left: NaN, top: 100, width: 40, height: 20 },
    { left: 70, top: 100, width: 40, height: Infinity }, { left: 430, top: 100, width: 40, height: 20 },
    { left: 0, top: 0, width: 30, height: 40 },
  ]
  assert.equal(proofTextPoint(rejected, bounds, viewport), null)
  assert.equal(proofTextPoint([], bounds, viewport), null, 'An image-only page or whitespace supplies no text geometry')
  assert.deepEqual(proofTextPoint([...rejected, partial], bounds, viewport), { x: 2.5, y: 132.5 })
  for (const invalid of [{ ...viewport, width: Infinity }, { ...viewport, height: 0 }]) {
    assert.equal(proofPoint(70, 100, bounds, invalid), null)
    assert.equal(proofTextPoint([partial], bounds, invalid), null)
  }
})

test('text selection and inverse points survive crop origins, all viewer rotations, zoom, CSS scaling and DPR', () => {
  // PDF.js viewport convention for crop box [-20, 30, 580, 830], including its Y flip.
  for (const rotation of [0, 90, 180, 270]) for (const scale of [0.5, 1.25, 2]) for (const cssScale of [0.75, 1, 1.5]) {
    const convert = (x: number, y: number) => rotation === 0 ? [(x + 20) * scale, (830 - y) * scale]
      : rotation === 90 ? [(y - 30) * scale, (x + 20) * scale]
        : rotation === 180 ? [(580 - x) * scale, (y - 30) * scale] : [(830 - y) * scale, (580 - x) * scale]
    const transformed = {
      width: (rotation % 180 ? 800 : 600) * scale, height: (rotation % 180 ? 600 : 800) * scale,
      convertToViewportRectangle: ([x1, y1, x2, y2]: number[]) => [...convert(x1, y1), ...convert(x2, y2)],
      convertToPdfPoint: (x: number, y: number) => rotation === 0 ? [x / scale - 20, 830 - y / scale]
        : rotation === 90 ? [y / scale - 20, x / scale + 30]
          : rotation === 180 ? [580 - x / scale, y / scale + 30] : [580 - y / scale, 830 - x / scale],
    }
    const bounds = { left: -63, top: 27, width: transformed.width * cssScale, height: transformed.height * cssScale }
    const box = proofSourceBox({ page: 2, x: 110, y: 700, width: 20, height: 20 }, transformed)!
    const text = { left: bounds.left + box.left * cssScale, top: bounds.top + box.top * cssScale, width: box.width * cssScale, height: box.height * cssScale }
    const [x, y] = convert(120, 710)
    for (const ratio of [1, 2, 3]) {
      const bitmap = proofBitmapSize(transformed.width, transformed.height, ratio)
      assert.equal(bitmap.density, Math.min(2, ratio))
      assert.deepEqual(proofTextPoint([text], bounds, transformed), { x: 120, y: 710 }, `rotation ${rotation}, zoom ${scale}, CSS ${cssScale}, DPR ${ratio}`)
      assert.deepEqual(proofPoint(bounds.left + x * cssScale, bounds.top + y * cssScale, bounds, transformed), { x: 120, y: 710 })
    }
  }
})

test('locate geometry has a bounded fragment budget and never substitutes a guessed page point', () => {
  let visited = 0
  function* rectangles() {
    while (visited < PROOF_LOCATE_LIMIT + 2) {
      visited++
      yield { left: 70, top: 100, width: visited > PROOF_LOCATE_LIMIT ? 40 : 0, height: 20 }
    }
  }
  assert.equal(proofTextPoint(rectangles(), { left: 30, top: 40, width: 400, height: 600 }, viewport), null)
  assert.equal(visited, PROOF_LOCATE_LIMIT + 1)
})

test('proof text identity includes project, revision, operation, source hash and canonical PDF hash', () => {
  const proof = { projectId: 'project', revision: 7, operationKey: 'operation', snapshotHash: 'source-hash', pdf: { id: 'pdf', sha256: 'pdf-hash', bytes: 100, pages: 2 } }
  const key = pdfProofIdentity(proof)
  for (const other of [{ ...proof, projectId: 'foreign' }, { ...proof, revision: 8 }, { ...proof, operationKey: 'next' }, { ...proof, snapshotHash: 'fork' }, { ...proof, pdf: { ...proof.pdf, sha256: 'other-pdf' } }]) assert.notEqual(pdfProofIdentity(other), key)
  assert.equal(pdfProofIdentity(null), '')
})

test('text inspection reads the same loaded document sequentially without sorting or normalizing PDF.js item order', async () => {
  const calls: number[] = [], input = '\u0995\u09cd\u200d\u09b7'
  const document = { numPages: 2, async getPage(page: number) {
    calls.push(page)
    return { async getTextContent(options: { disableNormalization: true }) {
      assert.equal(options.disableNormalization, true)
      return { items: page === 1 ? [{ str: 'Second column', hasEOL: true }, { type: 'beginMarkedContent' }, { str: 'First column', hasEOL: true }, { str: input }] : [{ str: 'Page two', hasEOL: true }] }
    } }
  } }
  const result = await extractProofText(document, 'captured-proof', 2)
  assert.deepEqual(calls, [1, 2])
  assert.equal(result.key, 'captured-proof')
  assert.equal(result.truncated, false)
  assert.equal(result.pages[0].text, `Second column\nFirst column\n${input} `)
  assert.equal(result.pages[1].text, 'Page two\n')
})

test('a page extraction failure remains local to text inspection and does not remove other pages or proof bytes', async () => {
  const original = new TextEncoder().encode('%PDF-1.7\nretained artifact').buffer, before = new Uint8Array(original).slice()
  const document = { numPages: 3, async getPage(page: number) { return { async getTextContent() {
    if (page === 2) throw new Error('Malformed optional text mapping')
    return { items: [{ str: page === 1 ? 'Retained text' : '' }] }
  } } } }
  const result = await extractProofText(document, 'proof', 3)
  assert.equal(result.pages.length, 3)
  assert.equal(result.pages[0].text, 'Retained text ')
  assert.match(result.pages[1].error!, /original PDF is unchanged/u)
  assert.equal(result.pages[2].error, null)
  assert.deepEqual(new Uint8Array(original), before)
  assert.deepEqual(copyProofBytes(original, original.byteLength), before)
})

test('superseded text inspection cannot publish old proof text after an asynchronous page load', async () => {
  let current = true, release!: () => void, textCalls = 0
  const pending = new Promise<void>((resolve) => { release = resolve })
  const document = { numPages: 1, async getPage() { await pending; return { async getTextContent() { textCalls++; return { items: [{ str: 'Old proof' }] } } } } }
  const extraction = extractProofText(document, 'old-proof', 1, () => current)
  current = false; release()
  await assert.rejects(extraction, { name: 'AbortError' })
  assert.equal(textCalls, 0)
})

test('optional PDF text inspection refuses mismatched documents and caps characters/items without splitting a surrogate', async () => {
  const calls: number[] = []
  const document = { numPages: 2, async getPage(page: number) { calls.push(page); return { async getTextContent() { return { items: [{ str: 'a'.repeat(PROOF_TEXT_LIMITS.characters - 1) + '\ud83d\ude00' }] } } } } }
  await assert.rejects(extractProofText(document, 'proof', 1), /does not match/u)
  await assert.rejects(extractProofText(document, '', 2), /does not match/u)
  const result = await extractProofText(document, 'proof', 2)
  assert.equal(result.truncated, true)
  assert.deepEqual(calls, [1])
  assert.equal(result.pages[0].text.length, PROOF_TEXT_LIMITS.characters - 1)
  assert.ok(!/[\ud800-\udfff]/u.test(result.pages[0].text))
  const manyItems = { numPages: 1, async getPage() { return { async getTextContent() { return { items: Array.from({ length: PROOF_TEXT_LIMITS.items + 1 }, () => ({ type: 'beginMarkedContent' })) } } } } }
  assert.equal((await extractProofText(manyItems, 'proof', 1)).truncated, true)
})

test('preview source keeps extraction opt-in and separate from render/proof failures and preserves measured maps', () => {
  const source = readFileSync(new URL('./LatexPdfPreview.tsx', import.meta.url), 'utf8')
  assert.match(source, /extractProofText\(validDocument, proofKey, expectedPages, \(\) => !disposed\)/u)
  assert.match(source, /!active \|\| !textOpen \|\| !validDocument/u)
  assert.match(source, /not an ATS score or a verified visual reading order/u)
  assert.match(source, /setTextFailure\(\{ key: proofKey, document: validDocument/u)
  assert.match(source, /extracted\?\.document === validDocument/u)
  assert.match(source, /new pdfjs.TextLayer/u)
  assert.match(source, /proofPoint\(event.clientX, event.clientY/u)
  assert.match(source, /editing\?: \{ projectId: string; revision: number \}/u)
  assert.doesNotMatch(source, /Editing r|editingRevision|proof\.syncAvailable/u)
})

test('preview disclosure is closed by default, controlled when supplied and uses captured proof details', () => {
  const source = readFileSync(new URL('./LatexPdfPreview.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./LatexPdfPreview.module.css', import.meta.url), 'utf8')
  assert.match(source, /\[localDetailsOpen, setLocalDetailsOpen\] = useState\(false\)/u)
  assert.match(source, /detailsExpanded = detailsOpen \?\? localDetailsOpen/u)
  assert.match(source, /deriveBuildDetails\(\{ proof, proofSource, currentAttempt \}\)/u)
  assert.match(source, /aria-expanded=\{detailsExpanded\} aria-controls=\{detailsId\}/u)
  assert.match(source, /hidden=\{!detailsExpanded\}/u)
  assert.match(source, /if \(detailsOpen === undefined\) setLocalDetailsOpen\(open\)/u)
  assert.match(source, /onDetailsOpenChange\?\.\(open\)/u)
  assert.match(source, /detailsToggle\.current\?\.focus\(\{ preventScroll: true \}\)/u)
  assert.equal(source.match(/Compiled r\{proof.revision\}/gu)?.length, 1)
  assert.doesNotMatch(source, /<footer/u)
  assert.match(css, /\.details\[hidden\] \{ display: none; \}/u)
})

test('locate mode navigates bounded real PDF text items and restores PDF.js selection semantics', () => {
  const source = readFileSync(new URL('./LatexPdfPreview.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./LatexPdfPreview.module.css', import.meta.url), 'utf8')
  assert.match(source, /canNavigate = Boolean\(active && proof && current && onPosition\)/u)
  assert.match(source, /textLayer\?\.textDivs/u)
  assert.match(source, /pageRendered.textItems.slice\(0, PROOF_LOCATE_LIMIT\)/u)
  assert.match(source, /proofTextPoint\(range.getClientRects\(\), bounds, pageRendered.viewport\)/u)
  assert.match(source, /proofTextPoint\(item.getClientRects\(\), surface.getBoundingClientRect\(\), pageRendered.viewport\)/u)
  assert.match(source, /item.tabIndex = index === 0 \? 0 : -1/u)
  assert.match(source, /item.getAttribute\('role'\)/u)
  assert.match(source, /item.removeAttribute\(name\)/u)
  assert.match(source, /event.key === 'Enter' \|\| event.key === ' '/u)
  assert.match(source, /event.key === 'Escape'/u)
  assert.match(css, /\.textLayer\[data-locating="true"\] \{ user-select: none; \}/u)
  assert.doesNotMatch(css, /touch-action:\s*none/u)
})

test('continuous proof exposes every page, independent errors and native keyboard scrolling without page-step buttons', () => {
  const source = readFileSync(new URL('./LatexPdfPreview.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./LatexPdfPreview.module.css', import.meta.url), 'utf8')
  assert.match(source, /Array.from\(\{ length: pages \}, \(_, index\) => renderPage\(index \+ 1\)\)/u)
  assert.doesNotMatch(source, /Previous PDF page|Next PDF page|scrollIntoView|addEventListener\('scroll'/u)
  assert.match(source, /tabIndex=\{0\} role="region" aria-label="Scrollable PDF document"/u)
  assert.match(source, /new IntersectionObserver/u)
  assert.match(source, /pageErrors\[pageNumber\]\?\.spec === currentSpec/u)
  assert.match(source, /surface.width = 0; surface.height = 0/u)
  assert.match(source, /pdfPage.cleanup\(\)/u)
  assert.match(source, /Math.min\(8000, remainingTextItems\)/u)
  assert.match(css, /\.pageStack \{[^}]*width: max-content; min-width: 100%/u)
  assert.match(css, /\.sheet\[data-ready="false"\] :is\(\.canvas, \.textLayer\)/u)
})

test('source selection follows its actual PDF page, including cross-page selections and a different visible page', () => {
  const source = readFileSync(new URL('./LatexPdfPreview.tsx', import.meta.url), 'utf8')
  assert.match(source, /fragment.setEnd\(container, container.childNodes.length\)/u)
  assert.match(source, /pageNumber = selected\?\.page \?\? selectedPage/u)
  assert.match(source, /closest<HTMLElement>\('\[data-page-text\]'\)/u)
  assert.match(source, /onPosition\?\.\(\{ page: pageNumber, \.\.\.point \}\)/u)
  assert.match(source, /appliedTarget.current === target/u)
  assert.match(source, /anchor.projectId !== proof.projectId/u)
  assert.match(source, /capturePageView\(\); setZoom/u)
  assert.match(source, /capturePageView\(\); setRotation/u)
})
