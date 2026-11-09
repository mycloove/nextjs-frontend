import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib'

/**
 * Lean, link-correct page copying for pdf-lib (CLAUDE.md §0.2/§4 — shared by
 * the split-pdf and merge-pdf engines, the two modules that build a new PDF
 * out of *some* pages of another).
 *
 * Why this exists — `copyPages` deep-copies everything a page can reach. An
 * internal link's destination names its target page, and that page's
 * /Parent is the whole page tree, so extracting just a contents page copied
 * every page of the document: page 1 of a 3.2 MB file came out at 3.2 MB.
 * The same path made in-document links point at an invisible duplicate page
 * instead of the real one, so they were dead even when the target was kept.
 * Annotation /P and article-bead /B back-references drag pages in the same
 * way. pdf-lib's `save()` writes every object in the context, reachable or
 * not, so the weight cannot be dropped after the fact by unlinking alone.
 *
 * Contract:
 *   1. `prepareSourceForCopy(src, tag)` once per loaded source, before any
 *      `copyPages` from it. Idempotent; only mutates the throwaway source.
 *   2. `copyPages` / `addPage` as usual.
 *   3. `finalizeCopiedPages(out)` once, after every page is added and before
 *      `save()`. Links to kept pages are re-pointed at them; links to pages
 *      that were left out are removed (a link that goes nowhere is a lie);
 *      everything no longer reachable is deleted.
 */

const TAG = PDFName.of('MyclooveSrcPage')
const P = PDFName.of('P')
const B = PDFName.of('B')
const ANNOTS = PDFName.of('Annots')
const SUBTYPE = PDFName.of('Subtype')
const LINK = PDFName.of('Link')
const DEST = PDFName.of('Dest')
const DESTS = PDFName.of('Dests')
const NAMES = PDFName.of('Names')
const KIDS = PDFName.of('Kids')
const A = PDFName.of('A')
const S = PDFName.of('S')
const D = PDFName.of('D')
const GOTO = PDFName.of('GoTo')

function nameKey(value: PDFObject | undefined): string | null {
  if (value instanceof PDFName) return value.decodeText()
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText()
  return null
}

/** Explicit destination array for a named destination, or null. */
function resolveNamedDest(doc: PDFDocument, key: string): PDFArray | null {
  const unwrap = (value: PDFObject | undefined): PDFArray | null => {
    const resolved = value instanceof PDFRef ? doc.context.lookup(value) : value
    if (resolved instanceof PDFArray) return resolved
    if (resolved instanceof PDFDict) {
      const inner = resolved.lookup(D)
      return inner instanceof PDFArray ? inner : null
    }
    return null
  }

  // PDF 1.1 style: /Dests dictionary keyed by name.
  const legacy = doc.catalog.lookup(DESTS)
  if (legacy instanceof PDFDict) {
    const hit = unwrap(legacy.get(PDFName.of(key)))
    if (hit) return hit
  }

  // PDF 1.2+ style: /Names /Dests name tree (string keys, Kids + Names).
  const names = doc.catalog.lookup(NAMES)
  const root = names instanceof PDFDict ? names.lookup(DESTS) : undefined
  const seen = new Set<PDFObject>()
  const walk = (node: PDFObject | undefined): PDFArray | null => {
    if (!(node instanceof PDFDict) || seen.has(node)) return null
    seen.add(node)
    const leaf = node.lookup(NAMES)
    if (leaf instanceof PDFArray) {
      for (let i = 0; i + 1 < leaf.size(); i += 2) {
        if (nameKey(leaf.lookup(i)) === key) return unwrap(leaf.get(i + 1))
      }
    }
    const kids = node.lookup(KIDS)
    if (kids instanceof PDFArray) {
      for (let i = 0; i < kids.size(); i++) {
        const hit = walk(kids.lookup(i))
        if (hit) return hit
      }
    }
    return null
  }
  return walk(root)
}

/** The explicit-destination array of a link annotation, if it has one. */
function linkDestArray(annot: PDFDict): { array: PDFArray | null; internal: boolean } {
  const dest = annot.lookup(DEST)
  if (dest instanceof PDFArray) return { array: dest, internal: true }
  if (dest !== undefined) return { array: null, internal: true }
  const action = annot.lookup(A)
  if (action instanceof PDFDict && action.lookup(S) === GOTO) {
    const d = action.lookup(D)
    return { array: d instanceof PDFArray ? d : null, internal: true }
  }
  return { array: null, internal: false }
}

/**
 * Step 1. Tag every page of `src` with `${tag}:${index}` so its copies can be
 * recognised later, inline named destinations as explicit ones (the source
 * catalog is never copied, so names would dangle), and cut the /P and /B
 * back-references that drag foreign pages into a copy.
 */
export function prepareSourceForCopy(src: PDFDocument, tag: string | number): void {
  const pages = src.getPages()
  pages.forEach((page, index) => {
    page.node.set(TAG, PDFString.of(`${tag}:${index}`))
    page.node.delete(B)
    const annots = page.node.lookup(ANNOTS)
    if (!(annots instanceof PDFArray)) return
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i)
      if (!(annot instanceof PDFDict)) continue
      annot.delete(P)
      if (annot.lookup(SUBTYPE) !== LINK) continue
      const named = nameKey(annot.lookup(DEST))
      if (named !== null) {
        const explicit = resolveNamedDest(src, named)
        if (explicit) annot.set(DEST, explicit)
        continue
      }
      const action = annot.lookup(A)
      if (action instanceof PDFDict && action.lookup(S) === GOTO) {
        const namedAction = nameKey(action.lookup(D))
        if (namedAction !== null) {
          const explicit = resolveNamedDest(src, namedAction)
          if (explicit) action.set(D, explicit)
        }
      }
    }
  })
}

function tagOf(doc: PDFDocument, value: PDFObject | undefined): string | null {
  const dict = value instanceof PDFRef ? doc.context.lookup(value) : value
  if (!(dict instanceof PDFDict)) return null
  const tag = dict.get(TAG)
  return tag instanceof PDFString ? tag.decodeText() : null
}

/** Delete every indirect object that the trailer can no longer reach. */
export function pruneUnreachable(doc: PDFDocument): number {
  const { context } = doc
  const reachable = new Set<string>()
  const stack: PDFObject[] = []
  const roots = [context.trailerInfo.Root, context.trailerInfo.Info, context.trailerInfo.Encrypt, context.trailerInfo.ID]
  for (const root of roots) if (root) stack.push(root as PDFObject)

  while (stack.length) {
    const node = stack.pop()!
    if (node instanceof PDFRef) {
      const key = node.toString()
      if (reachable.has(key)) continue
      reachable.add(key)
      const target = context.lookup(node)
      if (target) stack.push(target)
    } else if (node instanceof PDFDict) {
      for (const [, value] of node.entries()) stack.push(value)
    } else if (node instanceof PDFArray) {
      for (let i = 0; i < node.size(); i++) stack.push(node.get(i))
    } else if (node instanceof PDFStream) {
      stack.push(node.dict)
    }
  }

  let removed = 0
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) {
      context.delete(ref)
      removed++
    }
  }
  return removed
}

/**
 * Step 3. Re-point internal links at the real output pages, drop links whose
 * target was not kept, strip the copy tags, then delete everything the
 * document no longer reaches.
 */
export function finalizeCopiedPages(out: PDFDocument): void {
  const pages = out.getPages()
  const byTag = new Map<string, PDFRef>()
  for (const page of pages) {
    const tag = tagOf(out, page.node)
    // A page placed twice (merge duplicates) links to its first placement.
    if (tag !== null && !byTag.has(tag)) byTag.set(tag, page.ref)
  }

  for (const page of pages) {
    const annots = page.node.lookup(ANNOTS)
    if (annots instanceof PDFArray) {
      for (let i = annots.size() - 1; i >= 0; i--) {
        const annot = annots.lookup(i)
        if (!(annot instanceof PDFDict) || annot.lookup(SUBTYPE) !== LINK) continue
        const { array, internal } = linkDestArray(annot)
        if (!internal) continue // URI / launch / remote links stay as they are
        const target = array ? array.get(0) : undefined
        if (target instanceof PDFNumber) continue // already a page index
        const tag = tagOf(out, target)
        const kept = tag !== null ? byTag.get(tag) : undefined
        if (array && kept) array.set(0, kept)
        else annots.remove(i)
      }
    }
  }
  for (const page of pages) page.node.delete(TAG)
  pruneUnreachable(out)
}
