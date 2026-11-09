import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  type PDFPage,
} from 'pdf-lib'
import { finalizeCopiedPages, prepareSourceForCopy, pruneUnreachable } from './pageCopy.ts'

const HEAVY = 120_000

/**
 * A contents page linking to every chapter page. Each chapter carries an
 * incompressible 120 KB stream, so any page dragged in by mistake shows up
 * in the output size. Page 1 also has a URI link, a named-destination link
 * (to chapter 2 via the /Names tree) and annotation /P back-references.
 */
async function bookWithContents(chapters: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const contents = doc.addPage([300, 400])
  const pages: PDFPage[] = []
  for (let i = 0; i < chapters; i++) {
    const page = doc.addPage([300, 400])
    page.drawText(`Chapter ${i + 1}`, { x: 20, y: 360 })
    const heavy = doc.context.register(doc.context.stream(randomBytes(HEAVY)))
    page.node.set(PDFName.of('PieceInfo'), heavy)
    pages.push(page)
  }
  const ctx = doc.context
  const annots = pages.map((page, i) =>
    ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [20, 300 - i * 20, 200, 315 - i * 20],
      Dest: [page.ref, 'XYZ', null, null, null], P: contents.ref,
    })),
  )
  annots.push(ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [20, 40, 200, 55],
    A: { S: 'URI', URI: PDFString.of('https://example.com') },
  })))
  annots.push(ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [20, 20, 200, 35],
    Dest: PDFHexString.fromText('ch2'),
  })))
  contents.node.set(PDFName.of('Annots'), ctx.obj(annots))
  doc.catalog.set(PDFName.of('Names'), ctx.obj({
    Dests: { Names: [PDFHexString.fromText('ch2'), [pages[1].ref, 'Fit']] },
  }))
  return doc.save()
}

async function extract(bytes: Uint8Array, indices: number[]): Promise<PDFDocument> {
  const src = await PDFDocument.load(bytes)
  prepareSourceForCopy(src, 's')
  const out = await PDFDocument.create()
  for (const page of await out.copyPages(src, indices)) out.addPage(page)
  finalizeCopiedPages(out)
  return PDFDocument.load(await out.save({ useObjectStreams: true }))
}

function links(page: PDFPage): PDFDict[] {
  const annots = page.node.lookup(PDFName.of('Annots'))
  if (!(annots instanceof PDFArray)) return []
  return Array.from({ length: annots.size() }, (_, i) => annots.lookup(i)).filter(
    (a): a is PDFDict => a instanceof PDFDict,
  )
}

function destTarget(annot: PDFDict): PDFRef | undefined {
  const dest = annot.lookup(PDFName.of('Dest'))
  return dest instanceof PDFArray ? (dest.get(0) as PDFRef) : undefined
}

test('extracting a contents page does not drag the pages it links to', async () => {
  const book = await bookWithContents(6)
  assert.ok(book.length > HEAVY * 6)
  const out = await extract(book, [0])
  const bytes = await out.save({ useObjectStreams: true })
  assert.equal(out.getPageCount(), 1)
  assert.ok(bytes.length < 10_000, `expected a tiny contents page, got ${bytes.length} bytes`)
})

test('links to kept pages land on the real output pages; others are removed', async () => {
  const out = await extract(await bookWithContents(6), [0, 1, 2])
  const [contents, ch1, ch2] = out.getPages()
  const kept = links(contents)
  const internal = kept.filter((a) => destTarget(a) !== undefined)
  // ch1 + ch2 explicit links, plus the named "ch2" link (now explicit).
  assert.equal(internal.length, 3)
  const targets = internal.map((a) => destTarget(a)!.toString())
  assert.deepEqual(targets, [ch1.ref.toString(), ch2.ref.toString(), ch2.ref.toString()])
  // The URI link is not an internal link and survives untouched.
  assert.equal(kept.length - internal.length, 1)
  const uri = kept.find((a) => a.lookup(PDFName.of('A')) instanceof PDFDict)!
  assert.equal((uri.lookup(PDFName.of('A')) as PDFDict).lookup(PDFName.of('S')), PDFName.of('URI'))
})

test('output size scales with the pages kept, not the source', async () => {
  const book = await bookWithContents(6)
  const two = await (await extract(book, [0, 3])).save({ useObjectStreams: true })
  assert.ok(two.length > HEAVY && two.length < HEAVY * 1.3, `got ${two.length}`)
})

test('copy tags and back-references never reach the output', async () => {
  const out = await extract(await bookWithContents(3), [0, 1])
  for (const page of out.getPages()) {
    assert.equal(page.node.get(PDFName.of('MyclooveSrcPage')), undefined)
    for (const annot of links(page)) assert.equal(annot.get(PDFName.of('P')), undefined)
  }
})

test('merging two documents keeps each one\'s links inside itself', async () => {
  const a = await PDFDocument.load(await bookWithContents(2))
  const b = await PDFDocument.load(await bookWithContents(2))
  prepareSourceForCopy(a, 0)
  prepareSourceForCopy(b, 1)
  const out = await PDFDocument.create()
  for (const page of await out.copyPages(b, [0, 1, 2])) out.addPage(page) // B first
  for (const page of await out.copyPages(a, [0, 1, 2])) out.addPage(page)
  finalizeCopiedPages(out)
  const pages = out.getPages()
  const bLinks = links(pages[0]).map(destTarget).filter(Boolean).map(String)
  const aLinks = links(pages[3]).map(destTarget).filter(Boolean).map(String)
  assert.deepEqual(bLinks, [pages[1].ref, pages[2].ref, pages[2].ref].map(String))
  assert.deepEqual(aLinks, [pages[4].ref, pages[5].ref, pages[5].ref].map(String))
})

test('pruneUnreachable deletes orphans and keeps the live document intact', async () => {
  const doc = await PDFDocument.create()
  doc.addPage().drawText('kept')
  doc.context.register(doc.context.stream(randomBytes(50_000)))
  assert.equal(pruneUnreachable(doc), 1)
  const reloaded = await PDFDocument.load(await doc.save())
  assert.equal(reloaded.getPageCount(), 1)
})
