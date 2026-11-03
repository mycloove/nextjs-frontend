import assert from 'node:assert/strict'
import test from 'node:test'
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib'
import { verifyBrowserLatexPdf } from './browserPdfVerification.ts'
import { sha256 } from './project.ts'

async function pdf(pages = 1) {
  const document = await PDFDocument.create()
  for (let index = 0; index < pages; index++) document.addPage([595, 842]).drawText(`Real PDF page ${index + 1}`)
  return document
}
async function bytes(document: PDFDocument) { return new Uint8Array(await document.save({ addDefaultPage: false })).buffer }

test('actual PDF parsing, page traversal and SHA-256 verification retain exact canonical bytes', async () => {
  const data = await bytes(await pdf(2)), before = data.slice(0)
  assert.deepEqual(await verifyBrowserLatexPdf(data), { bytes: data.byteLength, pages: 2, sha256: await sha256(data) })
  assert.deepEqual(data, before)
})

test('a PDF-looking header is not proof of a complete parseable artifact', async () => {
  for (const data of [new TextEncoder().encode('%PDF-1.7\nnot a real PDF\n%%EOF\n').buffer, new ArrayBuffer(0), new ArrayBuffer(4 * 1024 * 1024)]) await assert.rejects(verifyBrowserLatexPdf(data))
  const real = await bytes(await pdf())
  await assert.rejects(verifyBrowserLatexPdf(real.slice(0, real.byteLength - 12)), /incomplete|trailer/)
  const altered = new TextDecoder('latin1').decode(new Uint8Array(real)).replace(/startxref\s+\d+/, 'startxref\n99999999')
  await assert.rejects(verifyBrowserLatexPdf(new TextEncoder().encode(altered).buffer), /cross-reference/)
})

test('repairable Catalog/Page startxref pointers and false xref table entries cannot pass byte verification', async () => {
  const document = await pdf()
  const data = new Uint8Array(await document.save({ useObjectStreams: false }))
  const text = new TextDecoder('latin1').decode(data)
  const encode = (value: string) => Uint8Array.from(value, (char) => char.charCodeAt(0)).buffer
  const root = document.context.trailerInfo.Root
  assert.ok(root instanceof PDFRef)
  const rootNumber = root.objectNumber
  const rootOffset = text.indexOf(`${rootNumber} 0 obj`)
  assert.ok(rootOffset > 0)
  await assert.rejects(verifyBrowserLatexPdf(encode(text.replace(/startxref\s+\d+/, `startxref\n${rootOffset}`))), /cross-reference|xref/i)
  const xrefOffset = Number(/startxref\s+(\d+)/.exec(text)![1])
  const corrupted = text.slice(0, xrefOffset) + text.slice(xrefOffset).replace(/\d{10} 00000 n/, `${String(rootOffset).padStart(10, '0')} 00000 n`)
  await assert.rejects(verifyBrowserLatexPdf(encode(corrupted)), /cross-reference|xref/i)
  const pageOffset = text.indexOf(`${document.getPage(0).ref.objectNumber} 0 obj`)
  const freePage = text.slice(0, xrefOffset) + text.slice(xrefOffset).replace(`${String(pageOffset).padStart(10, '0')} 00000 n`, '0000000000 00000 f')
  assert.notEqual(freePage, text)
  await assert.rejects(verifyBrowserLatexPdf(encode(freePage)), /cross-reference|xref/i)
})

test('excessive, empty, cyclic and inconsistent page trees cannot become verified proofs', async () => {
  await assert.rejects(verifyBrowserLatexPdf(await bytes(await pdf(33))), /page|count/)
  const empty = await pdf()
  empty.removePage(0)
  await assert.rejects(verifyBrowserLatexPdf(await bytes(empty)), /page|count/)
  const inconsistent = await pdf()
  const root = inconsistent.catalog.lookup(PDFName.of('Pages'), PDFDict)
  root.set(PDFName.of('Count'), PDFNumber.of(2))
  await assert.rejects(verifyBrowserLatexPdf(await bytes(inconsistent)), /page count/)
  const cyclic = await pdf()
  const pages = cyclic.catalog.lookup(PDFName.of('Pages'), PDFDict)
  pages.set(PDFName.of('Kids'), PDFArray.withContext(cyclic.context))
  const children = pages.lookup(PDFName.of('Kids'), PDFArray)
  children.push(cyclic.catalog.get(PDFName.of('Pages'))!)
  await assert.rejects(verifyBrowserLatexPdf(await bytes(cyclic)), /cyclic/)
})

test('unsafe dimensions and active PDF actions are refused instead of stripped', async () => {
  const large = await pdf()
  large.getPage(0).setSize(15000, 842)
  await assert.rejects(verifyBrowserLatexPdf(await bytes(large)), /dimensions/)
  for (const action of ['JavaScript', 'Launch', 'GoToR', 'SubmitForm']) {
    const document = await pdf()
    document.catalog.set(PDFName.of('OpenAction'), document.context.obj({ S: action, JS: 'private source must not execute' }))
    await assert.rejects(verifyBrowserLatexPdf(await bytes(document)), /active|unsafe/)
  }
})

test('ordinary HTTPS resume links remain usable but executable/file URLs are refused', async () => {
  for (const [uri, accepted] of [['https://example.com/work', true], ['mailto:hello@example.com', true], ['javascript:alert(1)', false], ['file:///private', false]] as const) {
    const document = await pdf()
    const action = document.context.obj({ Type: 'Action', S: 'URI', URI: PDFString.of(uri) })
    document.context.register(action)
    const data = await bytes(document)
    if (accepted) assert.equal((await verifyBrowserLatexPdf(data)).pages, 1)
    else await assert.rejects(verifyBrowserLatexPdf(data), /link scheme/)
  }
})
