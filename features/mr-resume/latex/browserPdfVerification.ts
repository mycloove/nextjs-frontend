import { LATEX_LIMITS } from './types.ts'
import type { PDFDict as PDFDictionary } from 'pdf-lib'
import { verifyCompilerCrossReferences } from './browserPdfCrossRefs.ts'

export type BrowserPdfVerification = { bytes: number; pages: number; sha256: string }

/** Runs in an isolated worker in production. Parsing never owns the download buffer. */
export async function verifyBrowserLatexPdf(data: ArrayBuffer): Promise<BrowserPdfVerification> {
  if (!(data instanceof ArrayBuffer) || data.byteLength < 32 || data.byteLength > LATEX_LIMITS.pdfBytes) throw new Error('The compiler PDF exceeds its byte limit or is empty.')
  const bytes = new Uint8Array(data)
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, 16))
  if (!/^%PDF-1\.[0-7](?:\r\n|\r|\n)/.test(header)) throw new Error('The compiler output is not a supported PDF.')
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 2048)))
  const trailer = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail)
  const offset = trailer ? Number(trailer[1]) : NaN
  if (!Number.isSafeInteger(offset) || offset < 8 || offset >= bytes.length) throw new Error('The compiler PDF is incomplete or has an invalid cross-reference trailer.')
  const xref = new TextDecoder('latin1').decode(bytes.subarray(offset, offset + 64))
  if (!/^(?:xref\b|\d+\s+\d+\s+obj\b)/.test(xref)) throw new Error('The compiler PDF has an invalid cross-reference offset.')
  const references = verifyCompilerCrossReferences(bytes, offset)

  const { PDFDocument, PDFArray, PDFDict, PDFStream, PDFName, PDFNumber, PDFString, PDFHexString } = await import('pdf-lib')
  const document = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true })
  if (document.context.trailerInfo.Root?.toString() !== references.root) throw new Error('The compiler PDF would require repairing its cross-reference root.')
  if (document.isEncrypted || document.context.trailerInfo.Encrypt) throw new Error('Encrypted PDFs cannot be accepted as compiler proofs.')
  const objects = document.context.enumerateIndirectObjects()
  if (objects.length > 25_000) throw new Error('The compiler PDF exceeds its object budget.')
  for (const [reference] of objects) if (!references.live.has(reference.toString())) throw new Error('The compiler PDF would require cross-reference repair of a free or unindexed object.')
  if (document.catalog.lookup(PDFName.of('Type')) !== PDFName.of('Catalog')) throw new Error('The PDF catalog is invalid.')
  const root = document.catalog.lookup(PDFName.of('Pages'), PDFDict)
  const seen = new Set<object>()
  let pages = 0
  function visit(node: PDFDictionary, depth: number): number {
    if (depth > 64 || seen.has(node)) throw new Error('The PDF page tree is cyclic or too deeply nested.')
    seen.add(node)
    const type = node.lookup(PDFName.of('Type'))
    if (type === PDFName.of('Page')) {
      if (++pages > LATEX_LIMITS.pages) throw new Error('The compiler PDF exceeds the 32-page limit.')
      return 1
    }
    if (type !== PDFName.of('Pages')) throw new Error('The PDF page tree contains an invalid node.')
    const children = node.lookup(PDFName.of('Kids'), PDFArray)
    const count = node.lookup(PDFName.of('Count'), PDFNumber).asNumber()
    if (!Number.isSafeInteger(count) || count < 1 || count > LATEX_LIMITS.pages || children.size() < 1 || children.size() > LATEX_LIMITS.pages) throw new Error('The PDF page tree has invalid counts.')
    let observed = 0
    for (let index = 0; index < children.size(); index++) observed += visit(children.lookup(index, PDFDict), depth + 1)
    if (observed !== count) throw new Error('The PDF page count disagrees with its page tree.')
    return observed
  }
  visit(root, 0)
  if (pages < 1 || document.getPageCount() !== pages) throw new Error('The compiler PDF has no valid pages.')
  for (const page of document.getPages()) {
    const { width, height } = page.getSize()
    if (![width, height].every((value) => Number.isFinite(value) && value > 0 && value <= 14_400)) throw new Error('The compiler PDF has unsafe page dimensions.')
  }
  const dangerousActions = new Set(['JavaScript', 'Launch', 'GoToR', 'GoToE', 'SubmitForm', 'ImportData', 'Rendition'])
  function inspect(value: unknown, depth: number, visited: Set<object>) {
    if (value instanceof PDFStream) { inspect(value.dict, depth + 1, visited); return }
    if (!(value instanceof PDFDict || value instanceof PDFArray)) return
    if (depth > 64) throw new Error('The compiler PDF object graph is too deeply nested.')
    if (visited.has(value)) return
    visited.add(value)
    if (value instanceof PDFArray) {
      for (let index = 0; index < value.size(); index++) inspect(value.get(index), depth + 1, visited)
      return
    }
    for (const [key, child] of value.entries()) {
      if (['JavaScript', 'JS', 'AA', 'EmbeddedFiles', 'XFA'].includes(key.decodeText())) throw new Error('The compiler PDF contains active content or embedded files.')
      inspect(child, depth + 1, visited)
    }
    const action = value.lookup(PDFName.of('S'))
    if (action instanceof PDFName && dangerousActions.has(action.decodeText())) throw new Error('The compiler PDF contains an unsafe action.')
    if (action === PDFName.of('URI')) {
      const uri = value.lookup(PDFName.of('URI'))
      if (!(uri instanceof PDFString || uri instanceof PDFHexString) || !/^(?:https?:|mailto:|tel:)/i.test(uri.decodeText())) throw new Error('The compiler PDF contains an unsupported link scheme.')
    }
  }
  const visited = new Set<object>()
  inspect(document.catalog, 0, visited)
  for (const [, object] of objects) inspect(object, 0, visited)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return { bytes: data.byteLength, pages, sha256: Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('') }
}
