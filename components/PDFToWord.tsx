'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useDropzone } from 'react-dropzone'
import { ApiClientError, getApiErrorMessage, toolRequest } from '@/lib/api/client'
import KineticSphere from '@/components/KineticSphere'
import { downloadBlob } from '@/lib/download/downloadOutputs'

/* ─────────────────────────────────────────────────────────────
   PDF → Word — "The Retype"

   Design concept: this tool turns a frozen page into living,
   editable text. The interface is a typesetter's proofing desk:
   a frozen specimen on the left, the live retype on the right,
   separated by the seam where ink becomes editable. The seam is
   the only bold gesture; everything around it stays quiet.

   After conversion the surface becomes a Word proofing desk:
   real page sheets reconstructed from the converted DOCX
   (`word/document.xml` + relationships + media, via jszip),
   paginated by measured height, with page thumbnails, an
   outline, zoom and an explicit download. The preview is
   deliberately labelled approximate: it is a reconstruction,
   not Word's own renderer.

   Honesty rules:
   - The old "Conversion Mode" selector was dead UI — still gone.
   - The limit is Flask's MAX_CONTENT_LENGTH = 100 MB (app.py),
     enforced again in the browser for an instant message.
    - Scanned PDFs fall back to OCR in features/pdf_to_word.py.
      Bangla depends on installed language data; layout is not guaranteed.
   - Conversion is indeterminate. No fake percentage exists.
   - The DOCX returned by the server is the same bytes the
     preview reads and the download saves.

   Everything is scoped to this file via the `p2w-` namespace.
   Chrome consumes surface-1 tokens; the paper itself is always
   white with fixed ink because that is the material of a Word
   page, in both themes.
   ───────────────────────────────────────────────────────────── */

/* Skeleton line widths — an irregular rhythm so the specimen reads
   as a real document, not a loading placeholder. */
const SPECIMEN_HEADING = 46
const SPECIMEN_LINES = [92, 78, 85, 58, 88, 71, 44]

type Phase = 'idle' | 'loaded' | 'converting' | 'done'
type PreviewStatus = 'idle' | 'pending' | 'ready' | 'unavailable'

/* Mirrors Flask's MAX_CONTENT_LENGTH (100 MB, app.py). */
const MAX_FILE_MB = 100

/* ── Preview geometry ──────────────────────────────────────
   A4 at 96 dpi is 794 × 1123; 680 × 962 keeps the same ratio
   while fitting the workspace column. Content width is what the
   hidden measurement pass uses, so pagination matches the sheet. */
const PAGE_W = 680
const PAGE_H = 962
const PAGE_PAD_X = 74
const PAGE_PAD_Y = 64
const CONTENT_W = PAGE_W - PAGE_PAD_X * 2
const CONTENT_H = PAGE_H - PAGE_PAD_Y * 2

interface Geometry {
  width: number
  height: number
  padX: number
  padY: number
  contentW: number
  contentH: number
}

const DEFAULT_GEOMETRY: Geometry = {
  width: PAGE_W,
  height: PAGE_H,
  padX: PAGE_PAD_X,
  padY: PAGE_PAD_Y,
  contentW: CONTENT_W,
  contentH: CONTENT_H,
}

/* Read the real page setup from the DOCX's first section. pdf2docx and Word
   both write pgSz/pgMar in twips; matching them is what keeps the proof's
   pages honest instead of reflowing the file into a different shape. */
function parseGeometry(xml: string): Geometry {
  const sect = /<w:sectPr\b[^>]*>([\s\S]*?)<\/w:sectPr>/.exec(xml)?.[1] ?? ''
  const pgSz = /<w:pgSz\b[^>]*>/.exec(sect)?.[0] ?? ''
  const pgMar = /<w:pgMar\b[^>]*>/.exec(sect)?.[0] ?? ''
  const px = (raw: string | undefined) => {
    const n = Number.parseInt(raw ?? '', 10)
    return Number.isFinite(n) ? Math.round((n * 96) / 1440) : 0
  }
  const width = Math.min(1100, Math.max(520, px(/w:w="(\d+)"/.exec(pgSz)?.[1]) || PAGE_W))
  const height = Math.min(1600, Math.max(700, px(/w:h="(\d+)"/.exec(pgSz)?.[1]) || PAGE_H))
  const left = Math.min(140, Math.max(20, px(/w:left="(\d+)"/.exec(pgMar)?.[1]) || PAGE_PAD_X))
  const right = Math.min(140, Math.max(20, px(/w:right="(\d+)"/.exec(pgMar)?.[1]) || PAGE_PAD_X))
  const top = Math.min(140, Math.max(20, px(/w:top="(\d+)"/.exec(pgMar)?.[1]) || PAGE_PAD_Y))
  const bottom = Math.min(140, Math.max(20, px(/w:bottom="(\d+)"/.exec(pgMar)?.[1]) || PAGE_PAD_Y))
  return {
    width,
    height,
    padX: Math.round((left + right) / 2),
    padY: Math.round((top + bottom) / 2),
    contentW: Math.max(320, width - left - right),
    contentH: Math.max(420, height - top - bottom),
  }
}

/* Preview budget caps. Anything beyond them still lives in the
   downloaded file, and the panel says so. */
const XML_READ_LIMIT = 1_500_000
const MAX_BLOCKS = 900
const MAX_TABLES = 60
const MAX_IMAGES = 48
const MAX_MEDIA_BYTES = 14 * 1024 * 1024

type Align = 'left' | 'center' | 'right' | 'justify'

interface Seg {
  text?: string
  br?: boolean
  b?: boolean
  i?: boolean
  u?: boolean
  half?: number
}

interface Cell {
  segs: Seg[]
  span: number
  fill?: string
}

interface TableRow {
  cells: Cell[]
  header: boolean
}

type Block =
  | {
      kind: 'p'
      align: Align
      segs: Seg[]
      heading?: number
      title?: boolean
      list?: { marker: string; level: number }
      before: number
      after: number
      indent: number
      lineHeight?: string
    }
  | { kind: 'table'; rows: TableRow[] }
  | { kind: 'image'; src: string; width: number; height: number; alt: string }
  | { kind: 'break' }

interface PreviewState {
  blocks: Block[]
  truncated: boolean
  stats: { words: number; tables: number; images: number }
  meta: { pages?: number; words?: number }
  geometry: Geometry
}

interface OutFile {
  blob: Blob
  name: string
}

/* ─────────────────────────────────────────────────────────────
   OOXML → preview model. Word's XML is verbose; these scanners
   rebuild an approximate reading of it. Text is decoded and
   emitted as React nodes (never dangerouslySetInnerHTML), so
   hostile document content cannot become markup here.
   ───────────────────────────────────────────────────────────── */

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g
const codePointOrEmpty = (n: number) => (n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '')

function decodeXmlText(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => codePointOrEmpty(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => codePointOrEmpty(parseInt(d, 10)))
    .replace(/&(lt|gt|quot|apos);/g, (_, n: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'" }[n] as string))
    .replace(/&amp;/g, '&')
    .replace(CONTROL_CHARS, '')
}

/* Bold/italic flags can be explicitly switched *off* inside runs
   (`<w:b w:val="0"/>` overrides a style's bold), so a flag counts
   only when it opens without an off value. Word also delimits
   tags tightly (`<w:b/>`) so a same-prefix tag like `<w:br/>`
   never matches this pattern. */
function flagOn(src: string, tag: string): boolean {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?/?>`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (/w:val="(?:0|false|none)"/i.test(m[0])) continue
    return true
  }
  return false
}

function underlineOn(run: string): boolean {
  const m = /<w:u\b[^>]*w:val="([^"]+)"/.exec(run)
  return !!m && !/^(?:none|0|false)$/i.test(m[1])
}

/* End index (past the closing tag) of a block, nesting-aware for
   tables. Returns -1 when the document ends mid-block — a signal
   the excerpt is truncated, which the preview reports. */
function findBlockEnd(xml: string, from: number, tag: string): number {
  const openRe = new RegExp(`<w:${tag}(?:\\s[^>]*)?>`, 'g')
  const closeRe = new RegExp(`</w:${tag}>`, 'g')
  let depth = 1
  let cursor = from
  while (cursor <= xml.length) {
    openRe.lastIndex = cursor
    closeRe.lastIndex = cursor
    const o = openRe.exec(xml)
    const c = closeRe.exec(xml)
    if (!c && !o) return -1
    if (c && (!o || c.index < o.index)) {
      depth -= 1
      if (depth === 0) return c.index + c[0].length
      cursor = c.index + c[0].length
    } else if (o) {
      depth += 1
      cursor = o.index + o[0].length
    }
  }
  return -1
}

const hasContent = (segs: Seg[]) => segs.some(s => s.br || (s.text ?? '').trim())
const plainText = (segs: Seg[]) => segs.map(s => (s.br ? ' ' : s.text ?? '')).join('').replace(/\s+/g, ' ').trim()

function headingInfo(style?: string, outline?: string): { level: number; title: boolean } | undefined {
  const s = (style ?? '').toLowerCase().replace(/\s+/g, '')
  if (s === 'title') return { level: 1, title: true }
  if (s === 'subtitle') return { level: 2, title: false }
  const match = /^heading([1-6])$/.exec(s)
  if (match) return { level: Number(match[1]), title: false }
  if (outline != null) {
    const level = Number.parseInt(outline, 10)
    if (Number.isFinite(level) && level >= 0 && level < 6) return { level: level + 1, title: false }
  }
  return undefined
}

/* Twips → px at 96 dpi, capped so a pathological attribute cannot
   collapse or blow up the page rhythm. */
function twipsToPx(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(48, Math.round((n * 96) / 1440)))
}

function spacingValue(tag: string, name: string): string | undefined {
  return new RegExp(`w:${name}="(-?\\d+)"`).exec(tag)?.[1]
}

function roman(n: number): string {
  const pairs: Array<[number, string]> = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ]
  let left = n
  let out = ''
  for (const [value, glyph] of pairs) {
    while (left >= value) {
      out += glyph
      left -= value
    }
  }
  return out
}

function listMarker(fmt: string, n: number): string {
  if (fmt === 'lowerLetter') return `${String.fromCharCode(97 + ((n - 1) % 26))}.`
  if (fmt === 'upperLetter') return `${String.fromCharCode(65 + ((n - 1) % 26))}.`
  if (fmt === 'lowerRoman') return `${roman(n)}.`
  if (fmt === 'upperRoman') return `${roman(n).toUpperCase()}.`
  return `${n}.`
}

function collectSegs(src: string): Seg[] {
  const raw: Seg[] = []
  const runRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g
  let rm: RegExpExecArray | null
  while ((rm = runRe.exec(src))) {
    const run = rm[1]
    const b = flagOn(run, 'w:b')
    const i = flagOn(run, 'w:i')
    const u = underlineOn(run)
    const half = Number.parseInt(/<w:sz\s+w:val="(\d+)"/.exec(run)?.[1] ?? '', 10) || undefined
    const pieceRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>|<w:br\b[^>]*\/?>|<w:tab\b[^>]*\/?>/g
    let pm: RegExpExecArray | null
    while ((pm = pieceRe.exec(run))) {
      if (pm[1] !== undefined) raw.push({ text: decodeXmlText(pm[1]), b, i, u, half })
      else if (pm[0].startsWith('<w:br')) raw.push({ br: true })
      else if (pm[0].startsWith('<w:tab')) raw.push({ text: '\u2003', b, i, u, half })
    }
  }

  const segs: Seg[] = []
  for (const seg of raw) {
    if (seg.br) {
      segs.push(seg)
      continue
    }
    const prev = segs[segs.length - 1]
    const same =
      prev && !prev.br &&
      (prev.b ?? false) === (seg.b ?? false) &&
      (prev.i ?? false) === (seg.i ?? false) &&
      (prev.u ?? false) === (seg.u ?? false) &&
      (prev.half ?? 0) === (seg.half ?? 0)
    if (same) prev.text = (prev.text ?? '') + (seg.text ?? '')
    else segs.push({ ...seg })
  }
  return segs
}

interface ScanCtx {
  media: Map<string, string>
  numbering: Map<string, string>
  counters: Map<string, number>
  images: number
}

function parseImages(src: string, ctx: ScanCtx): Block[] {
  const out: Block[] = []
  const drawingRe = /<(w:drawing|w:pict)>([\s\S]*?)<\/\1>/g
  let dm: RegExpExecArray | null
  while ((dm = drawingRe.exec(src))) {
    if (ctx.images >= MAX_IMAGES) break
    const inner = dm[2]
    const rid = /r:(?:embed|id|link)="([^"]+)"/.exec(inner)?.[1]
    const srcUrl = rid ? ctx.media.get(rid) : undefined
    if (!srcUrl) continue

    const extent = /<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"/.exec(inner)
    const cx = Number.parseInt(extent?.[1] ?? '0', 10)
    const cy = Number.parseInt(extent?.[2] ?? '0', 10)
    let width = cx > 0 ? Math.min(CONTENT_W, cx / 9525) : CONTENT_W
    let height = cx > 0 && cy > 0 ? (cy / 9525) * (width / (cx / 9525)) : width * 0.62
    if (height > 720) {
      width *= 720 / height
      height = 720
    }
    const alt = decodeXmlText(/<wp:docPr\b[^>]*descr="([^"]*)"/.exec(inner)?.[1] ?? '') || 'Image from the converted document'
    out.push({ kind: 'image', src: srcUrl, width: Math.max(32, Math.round(width)), height: Math.max(24, Math.round(height)), alt })
    ctx.images += 1
  }
  return out
}

/* One paragraph → block(s). Run properties carry bold / italic /
   underline / size; `<w:br/>` becomes a line break, `<w:tab/>` a
   wide space, and a page break splits the paragraph. */
function parseParagraph(src: string, ctx: ScanCtx): Block[] {
  const out: Block[] = []
  const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(src)?.[1] ?? ''
  const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(pPr)?.[1]
  const outline = /<w:outlineLvl\s+w:val="(\d+)"/.exec(pPr)?.[1]
  const heading = headingInfo(style, outline)

  const jc = /<w:jc\s+w:val="([^"]+)"/.exec(pPr)?.[1]
  const align: Align = jc === 'center' ? 'center' : jc === 'right' ? 'right' : jc === 'both' || jc === 'justify' ? 'justify' : 'left'

  const spacingTag = /<w:spacing\b[^>]*>/.exec(pPr)?.[0] ?? ''
  const before = heading
    ? twipsToPx(spacingValue(spacingTag, 'before'), 18)
    : twipsToPx(spacingValue(spacingTag, 'before'), 0)
  const after = heading
    ? twipsToPx(spacingValue(spacingTag, 'after'), 10)
    : twipsToPx(spacingValue(spacingTag, 'after'), 8)

  const indTag = /<w:ind\b[^>]*>/.exec(pPr)?.[0] ?? ''
  const indent = Math.max(0, Math.min(96, twipsToPx(spacingValue(indTag, 'left'), 0)))

  /* The DOCX may pin line height (`w:line="220"` + `lineRule="exact"` =
     11pt) or scale it (`lineRule="auto"`, where 240 = single spacing).
     Honouring either is what keeps a page's content on the same page as
     the real file; a generic 1.5 line-height silently reflows it. */
  const lineRaw = spacingValue(spacingTag, 'line')
  const lineRule = /w:lineRule="([^"]+)"/.exec(spacingTag)?.[1]
  const lineHeight = lineRaw
    ? lineRule === 'exact' || lineRule === 'atLeast'
      ? `${Math.max(10, Math.min(64, Math.round((Number.parseInt(lineRaw, 10) * 96) / 1440)))}px`
      : `${Math.max(1, Math.min(2.6, Math.round(((Number.parseInt(lineRaw, 10) / 240) * 1.22) * 100) / 100))}`
    : undefined

  let list: { marker: string; level: number } | undefined
  const numPr = /<w:numPr>([\s\S]*?)<\/w:numPr>/.exec(pPr)?.[1]
  if (numPr) {
    const numId = /<w:numId\s+w:val="(\d+)"/.exec(numPr)?.[1]
    const ilvl = Number.parseInt(/<w:ilvl\s+w:val="(\d+)"/.exec(numPr)?.[1] ?? '0', 10)
    const level = Math.max(0, Math.min(4, Number.isFinite(ilvl) ? ilvl : 0))
    if (numId) {
      const fmt = ctx.numbering.get(numId) ?? 'bullet'
      let marker = '\u2022'
      if (fmt !== 'bullet' && fmt !== 'none') {
        const key = `${numId}:${level}`
        const n = (ctx.counters.get(key) ?? 0) + 1
        ctx.counters.set(key, n)
        marker = listMarker(fmt, n)
      }
      list = { marker, level }
    }
  }

  if (/<w:pageBreakBefore\b/.test(pPr)) out.push({ kind: 'break' })

  /* pdf2docx represents every source page as a section (a page-sized
     sectPr on an otherwise empty paragraph). Honouring those keeps the
     proof on the same pages as the file instead of silently reflowing
     it. A continuous section is a column/layout change, not a page. */
  const sectionBreak = /<w:sectPr\b/.test(pPr) && !/<w:type\s+w:val="continuous"/.test(pPr)

  let segs: Seg[] = []
  const flush = () => {
    if (!hasContent(segs)) {
      segs = []
      return
    }
    out.push({
      kind: 'p',
      align,
      segs,
      heading: heading?.level,
      title: heading?.title,
      list,
      before,
      after,
      indent,
      lineHeight,
    })
    segs = []
  }

  const runRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g
  let rm: RegExpExecArray | null
  while ((rm = runRe.exec(src))) {
    const run = rm[1]
    const b = flagOn(run, 'w:b')
    const i = flagOn(run, 'w:i')
    const u = underlineOn(run)
    const half = Number.parseInt(/<w:sz\s+w:val="(\d+)"/.exec(run)?.[1] ?? '', 10) || undefined
    const pieceRe =
      /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>|<w:lastRenderedPageBreak\b[^>]*\/?>|<w:br\b[^>]*\/?>|<w:tab\b[^>]*\/?>/g
    let pm: RegExpExecArray | null
    while ((pm = pieceRe.exec(run))) {
      if (pm[1] !== undefined) {
        segs.push({ text: decodeXmlText(pm[1]), b, i, u, half })
      } else if (pm[0].startsWith('<w:lastRenderedPageBreak')) {
        flush()
        out.push({ kind: 'break' })
      } else if (pm[0].startsWith('<w:br')) {
        if (/w:type="page"/.test(pm[0])) {
          flush()
          out.push({ kind: 'break' })
        } else {
          segs.push({ br: true })
        }
      } else if (pm[0].startsWith('<w:tab')) {
        segs.push({ text: '\u2003', b, i, u, half })
      }
    }
  }
  flush()
  if (sectionBreak) out.push({ kind: 'break' })

  const images = parseImages(src, ctx)
  if (images.length) out.push(...images)
  return out
}

/* One table → rows of cells. Nested tables inside cells degrade
   into extra text rather than confusing the grid — an acceptable
   approximation under the "preview is approximate" contract. */
function parseTable(src: string): Block | null {
  const rows: TableRow[] = []
  const rowRe = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g
  let rr: RegExpExecArray | null
  while ((rr = rowRe.exec(src)) && rows.length < 80) {
    const rowSrc = rr[1]
    const header = /<w:tblHeader\b/.test(rowSrc)
    const cells: Cell[] = []
    const cellRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g
    let cm: RegExpExecArray | null
    while ((cm = cellRe.exec(rowSrc)) && cells.length < 24) {
      const cSrc = cm[1]
      const span = Math.max(1, Math.min(8, Number.parseInt(/<w:gridSpan\s+w:val="(\d+)"/.exec(cSrc)?.[1] ?? '1', 10) || 1))
      const fillRaw = /<w:shd\b[^>]*w:fill="([0-9A-Fa-f]{6})"/.exec(cSrc)?.[1]
      const fill = fillRaw && fillRaw.toLowerCase() !== 'auto' ? `#${fillRaw}` : undefined
      cells.push({ segs: collectSegs(cSrc), span, fill })
    }
    if (cells.length) rows.push({ cells, header })
  }
  return rows.length ? { kind: 'table', rows } : null
}

function scanBlocks(xml: string, ctx: ScanCtx): { blocks: Block[]; truncated: boolean } {
  const blocks: Block[] = []
  let tables = 0
  let truncated = false
  let idx = 0
  const next = /<w:(p|tbl)(?:\s[^>]*)?[>/ ]/g
  for (;;) {
    next.lastIndex = idx
    const m = next.exec(xml)
    if (!m) break
    if (!m[0].endsWith('>')) {
      idx = m.index + m[0].length
      continue
    }
    const bodyStart = xml.indexOf('>', m.index) + 1
    const end = findBlockEnd(xml, bodyStart, m[1])
    if (end === -1) {
      truncated = true
      break
    }
    const src = xml.slice(bodyStart, end - `</w:${m[1]}>`.length)
    if (m[1] === 'p') {
      blocks.push(...parseParagraph(src, ctx))
    } else {
      if (tables >= MAX_TABLES) {
        truncated = true
        break
      }
      tables += 1
      const table = parseTable(src)
      if (table) blocks.push(table)
    }
    idx = end
    if (blocks.length >= MAX_BLOCKS) {
      next.lastIndex = idx
      if (next.exec(xml)) truncated = true
      break
    }
  }
  return { blocks, truncated }
}

function parseRels(xml: string): Map<string, string> {
  const rels = new Map<string, string>()
  if (!xml) return rels
  const re = /<Relationship\b[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const tag = m[0]
    if (/TargetMode="External"/i.test(tag)) continue
    const id = /Id="([^"]+)"/.exec(tag)?.[1]
    const target = /Target="([^"]+)"/.exec(tag)?.[1]
    if (id && target) rels.set(id, target)
  }
  return rels
}

function parseNumbering(xml: string): Map<string, string> {
  const formats = new Map<string, string>()
  if (!xml) return formats
  const abstract = new Map<string, string>()
  const absRe = /<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g
  let am: RegExpExecArray | null
  while ((am = absRe.exec(xml))) {
    const level = /<w:lvl\b[^>]*w:ilvl="0"[^>]*>([\s\S]*?)<\/w:lvl>/.exec(am[2])?.[1] ?? am[2]
    const fmt = /<w:numFmt\s+w:val="([^"]+)"/.exec(level)?.[1]
    if (fmt) abstract.set(am[1], fmt)
  }
  const numRe = /<w:num\b[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g
  let nm: RegExpExecArray | null
  while ((nm = numRe.exec(xml))) {
    const absId = /<w:abstractNumId\s+w:val="(\d+)"/.exec(nm[2])?.[1]
    const fmt = absId ? abstract.get(absId) : undefined
    if (fmt) formats.set(nm[1], fmt)
  }
  return formats
}

function parseAppProps(xml: string): { pages?: number; words?: number } {
  if (!xml) return {}
  const pick = (tag: string) => {
    const m = new RegExp(`<${tag}>(\\d+)</${tag}>`).exec(xml)
    return m ? Number.parseInt(m[1], 10) : undefined
  }
  return { pages: pick('Pages'), words: pick('Words') }
}

function collectStats(blocks: Block[]) {
  let words = 0
  let tables = 0
  let images = 0
  for (const block of blocks) {
    if (block.kind === 'p') {
      const text = plainText(block.segs)
      if (text) words += text.split(/\s+/).filter(Boolean).length
    } else if (block.kind === 'table') {
      tables += 1
      for (const row of block.rows) {
        for (const cell of row.cells) {
          const text = plainText(cell.segs)
          if (text) words += text.split(/\s+/).filter(Boolean).length
        }
      }
    } else if (block.kind === 'image') {
      images += 1
    }
  }
  return { words, tables, images }
}

/* Greedy page packing by measured height. A heading never closes a
   page alone; explicit page breaks force a new page. Oversized
   blocks (tall tables, big images) get their own page and are
   allowed to grow — the preview never clips content. */
function paginate(blocks: Block[], heights: Map<number, number>, contentH: number): Block[][] {
  const pages: Block[][] = []
  let current: Block[] = []
  let used = 0
  const commit = () => {
    if (current.length) {
      pages.push(current)
      current = []
      used = 0
    }
  }

  blocks.forEach((block, index) => {
    if (block.kind === 'break') {
      commit()
      return
    }
    const h = heights.get(index) ?? 24
    const nextH = heights.get(index + 1) ?? 24
    const headingAlone = block.kind === 'p' && block.heading != null
    if (current.length && (used + h > contentH || (headingAlone && used + h + nextH > contentH))) {
      commit()
    }
    current.push(block)
    used += h
  })
  commit()
  return pages
}

/* ─────────────────────────────────────────────────────────────
   The retyped-document specimen. One markup, three modes:
   specimen — empty-state invitation, seam parked at 40%
   loaded   — fully frozen, caret waiting above the first line
   converting — seam descends in an indeterminate loop
   ───────────────────────────────────────────────────────────── */
function RetypeDoc({ mode }: { mode: 'specimen' | 'loaded' | 'converting' }) {
  const rows = () => (
    <div className="p2w-rows">
      <span className="p2w-row p2w-row-h" style={{ '--w': `${SPECIMEN_HEADING}%` } as CSSProperties} />
      {SPECIMEN_LINES.map((w, i) => (
        <span key={i} className="p2w-row" style={{ '--w': `${w}%` } as CSSProperties} />
      ))}
    </div>
  )

  return (
    <div className={`p2w-doc p2w-doc-${mode}`} aria-hidden="true">
      <div className="p2w-doc-sheet">
        {rows()}
        <div className="p2w-live">{rows()}</div>
        <span className="p2w-ruler" />
        <span className="p2w-seam" />
        <span className="p2w-caret" />
      </div>
    </div>
  )
}

function TextSegs({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((seg, i) => {
        if (seg.br) return <br key={i} />
        const text = seg.text ?? ''
        if (!text) return null
        let node: ReactNode = text
        if (seg.b) node = <strong>{node}</strong>
        if (seg.i) node = <em>{node}</em>
        if (seg.u) node = <u>{node}</u>
        const style: CSSProperties = {}
        if (seg.half) style.fontSize = Math.min(28, Math.max(9, Math.round(seg.half * 0.667)))
        return (
          <span key={i} style={Object.keys(style).length ? style : undefined}>
            {node}
          </span>
        )
      })}
    </>
  )
}

function BlockView({ block, measureIndex }: { block: Block; measureIndex?: number }) {
  const measure = measureIndex != null ? { 'data-mblock': measureIndex } : {}

  if (block.kind === 'break') return null

  if (block.kind === 'image') {
    return (
      // Blob URLs from the converted DOCX cannot go through Next's image
      // optimizer; the dimensions are known and fixed, so layout is stable.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        {...measure}
        className="p2w-doc-img"
        src={block.src}
        width={block.width}
        height={block.height}
        alt={block.alt}
        loading="lazy"
        decoding="async"
      />
    )
  }

  if (block.kind === 'table') {
    const cols = Math.max(
      1,
      ...block.rows.map(row => row.cells.reduce((sum, cell) => sum + cell.span, 0)),
    )
    return (
      <div {...measure} className="p2w-doc-tablewrap">
        <div className="p2w-doc-table" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {block.rows.flatMap((row, r) =>
            row.cells.map((cell, c) => (
              <div
                key={`${r}-${c}`}
                className={`p2w-doc-td${row.header ? ' is-head' : ''}`}
                style={{
                  gridColumn: `span ${cell.span}`,
                  background: cell.fill,
                }}
              >
                <TextSegs segs={cell.segs} />
              </div>
            )),
          )}
        </div>
      </div>
    )
  }

  const style: CSSProperties = {
    textAlign: block.align !== 'left' ? block.align : undefined,
    marginTop: block.before || undefined,
    marginBottom: block.after || undefined,
    lineHeight: block.lineHeight || undefined,
  }

  if (block.heading) {
    return (
      <div
        {...measure}
        className={`p2w-doc-h p2w-doc-h${block.heading}${block.title ? ' is-title' : ''}`}
        style={style}
      >
        <TextSegs segs={block.segs} />
      </div>
    )
  }

  if (block.list) {
    return (
      <div
        {...measure}
        className="p2w-doc-li"
        style={{ ...style, paddingLeft: Math.min(72, block.indent + block.list.level * 20) }}
      >
        <span className="p2w-doc-marker">{block.list.marker}</span>
        <span className="p2w-doc-litext">
          <TextSegs segs={block.segs} />
        </span>
      </div>
    )
  }

  return (
    <p {...measure} className="p2w-doc-p" style={style}>
      <TextSegs segs={block.segs} />
    </p>
  )
}

function thumbLines(page: Block[]): Array<{ kind: 'line' | 'image' | 'table'; width: number }> {
  const out: Array<{ kind: 'line' | 'image' | 'table'; width: number }> = []
  for (const block of page) {
    if (out.length >= 9) break
    if (block.kind === 'image') {
      out.push({ kind: 'image', width: 100 })
      continue
    }
    if (block.kind === 'table') {
      out.push({ kind: 'table', width: 100 })
      continue
    }
    if (block.kind !== 'p') continue
    const text = plainText(block.segs)
    if (!text) continue
    const lines = Math.min(block.heading ? 1 : 3, Math.max(1, Math.ceil(text.length / 58)))
    for (let i = 0; i < lines && out.length < 9; i += 1) {
      const seed = text.length * 7 + i * 13
      out.push({ kind: 'line', width: block.heading ? 62 : 78 + (seed % 20) })
    }
  }
  return out.length ? out : [{ kind: 'line', width: 80 }]
}

function PageSheet({ page, index, total, zoom, geometry }: { page: Block[]; index: number; total: number; zoom: number; geometry: Geometry }) {
  return (
    <div className="p2w-page-wrap" data-page={index}>
      <div
        className="p2w-page"
        style={{
          zoom,
          width: geometry.width,
          minHeight: geometry.height,
          padding: `${geometry.padY}px ${geometry.padX}px`,
        }}
      >
        <div className="p2w-page-body">
          {page.map((block, i) => (
            <BlockView key={i} block={block} />
          ))}
        </div>
      </div>
      <span className="p2w-page-tag">
        PAGE {index + 1} / {total}
      </span>
    </div>
  )
}

/* A cancel through toolRequest arrives as an ApiClientError whose cause is the
   AbortError (lib/api/client.ts), so a deliberate stop is told apart from a
   real failure and needs no error message. */
const isCancellation = (e: unknown) =>
  e instanceof ApiClientError && (e.cause as { name?: string } | undefined)?.name === 'AbortError'

/* A source that already carries the brand prefix must not become
   mycloove_mycloove_… when it is converted and downloaded again. */
const docxNameFor = (pdfName: string) =>
  'mycloove_' + pdfName.replace(/\.pdf$/i, '').replace(/^mycloove_/i, '') + '.docx'

export default function PDFToWord() {
  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // The finished DOCX is held, not just pushed to disk, so a missed save is one
  // click away from recovery instead of one full re-conversion.
  const [output, setOutput] = useState<OutFile | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('idle')
  // Preview-first is the default: conversion lands in the proofing desk and the
  // download is an explicit choice. The switch still allows hands-off saving.
  const [autoDownload, setAutoDownload] = useState(false)
  const [pages, setPages] = useState<Block[][]>([])
  const [activePage, setActivePage] = useState(0)
  const [zoom, setZoom] = useState(0.9)

  const abortRef = useRef<AbortController | null>(null)
  const runIdRef = useRef(0) // invalidates late preview builds when a new run starts
  const objectUrlsRef = useRef<string[]>([])
  const measureRef = useRef<HTMLDivElement | null>(null)
  const deskRef = useRef<HTMLDivElement | null>(null)
  // Once the reader picks a zoom, resizing the window must not silently
  // override it. "Fit" clears this flag again.
  const manualZoomRef = useRef(false)

  const clearPreviewUrls = useCallback(() => {
    objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
    objectUrlsRef.current = []
  }, [])

  // Stop any in-flight run and release preview image URLs on unmount.
  useEffect(
    () => () => {
      abortRef.current?.abort()
      objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
    },
    [],
  )

  const clearResult = useCallback(() => {
    setOutput(null)
    setPreview(null)
    setPreviewStatus('idle')
    setPages([])
    setActivePage(0)
    manualZoomRef.current = false
    clearPreviewUrls()
  }, [clearPreviewUrls])

  const onDrop = useCallback(
    (accepted: File[]) => {
      const pdf = accepted.find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
      if (!pdf) return
      if (pdf.size > MAX_FILE_MB * 1024 * 1024) {
        setError(`${pdf.name} is ${(pdf.size / 1048576).toFixed(1)} MB — the limit is ${MAX_FILE_MB} MB.`)
        return
      }
      abortRef.current?.abort()
      runIdRef.current += 1
      clearResult()
      setFile(pdf)
      setPhase('loaded')
      setError(null)
      setNotice(null)
    },
    [clearResult],
  )

  /* noClick: the visible Choose a PDF button and the station's Replace action
     own the file picker, so the drop plate never hijacks a click. */
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    onDropRejected: rejections => {
      const name = rejections[0]?.file?.name
      setError(name ? `${name} is not a PDF — choose a .pdf file.` : 'That file is not a PDF — choose a .pdf file.')
    },
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    noClick: true,
    disabled: phase === 'converting',
  })

  /* Build the proof from the *actual* converted file. jszip stays out of the
     initial bundle. Every failure path is honest: the download is unaffected,
     and the panel says the preview could not be reconstructed. */
  const buildPreview = useCallback(
    async (blob: Blob, run: number) => {
      try {
        const { default: JSZip } = await import('jszip')
        const zip = await JSZip.loadAsync(blob)
        const docFile = zip.file('word/document.xml')
        if (!docFile) {
          if (run === runIdRef.current) setPreviewStatus('unavailable')
          return
        }

        const fullXml = await docFile.async('string')
        const xml = fullXml.slice(0, XML_READ_LIMIT)
        const relsXml = (await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? ''
        const rels = parseRels(relsXml)

        const media = new Map<string, string>()
        const urls: string[] = []
        let budget = MAX_MEDIA_BYTES
        for (const [id, target] of rels) {
          if (media.size >= MAX_IMAGES || budget <= 0) break
          if (!/\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(target)) continue
          const mediaFile = zip.file(`word/${target.replace(/^\.?\//, '')}`)
          if (!mediaFile) continue
          const mediaBlob = await mediaFile.async('blob')
          if (mediaBlob.size > budget) continue
          budget -= mediaBlob.size
          const url = URL.createObjectURL(mediaBlob)
          urls.push(url)
          media.set(id, url)
        }

        if (run !== runIdRef.current) {
          urls.forEach(url => URL.revokeObjectURL(url))
          return
        }

        const numbering = parseNumbering((await zip.file('word/numbering.xml')?.async('string')) ?? '')
        const appXml = (await zip.file('docProps/app.xml')?.async('string')) ?? ''
        const meta = parseAppProps(appXml)
        const scanned = scanBlocks(xml, { media, numbering, counters: new Map(), images: 0 })
        const stats = collectStats(scanned.blocks)
        const truncated = scanned.truncated || fullXml.length > XML_READ_LIMIT
        const geometry = parseGeometry(fullXml)

        clearPreviewUrls()
        objectUrlsRef.current = urls
        setPreview({ blocks: scanned.blocks, truncated, stats, meta, geometry })
        setPreviewStatus(scanned.blocks.length ? 'ready' : 'unavailable')
      } catch {
        if (run === runIdRef.current) setPreviewStatus('unavailable')
      }
    },
    [clearPreviewUrls],
  )

  const convert = async () => {
    if (!file || phase === 'converting') return
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB — the limit is ${MAX_FILE_MB} MB.`)
      return
    }
    const run = runIdRef.current + 1
    runIdRef.current = run
    setPhase('converting')
    setError(null)
    setNotice(null)
    clearResult()
    setPreviewStatus('pending')

    const controller = new AbortController()
    abortRef.current = controller
    try {
      const formData = new FormData()
      formData.append('pdf', file)

      const res = await toolRequest('/api/pdf-to-word', { method: 'POST', body: formData, signal: controller.signal })
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'We could not convert this PDF. Please try again.'))
        setPhase('loaded')
        setPreviewStatus('idle')
        return
      }

      const blob = await res.blob()
      // The artifact carries the mycloove brand. The backend writes the same
      // name (features/pdf_to_word.py, send_file download_name).
      const name = docxNameFor(file.name)
      abortRef.current = null
      setOutput({ blob, name })
      if (autoDownload) downloadBlob(blob, name)
      setPhase('done')
      void buildPreview(blob, run)
    } catch (e) {
      if (isCancellation(e)) {
        setPhase('loaded') // file stays loaded — retry from the station
        setPreviewStatus('idle')
        setNotice('Conversion cancelled — your PDF is still loaded, ready to retype again.')
        return
      }
      setError(e instanceof Error ? e.message : 'Failed to convert. Please try again.')
      setPhase('loaded') // file stays loaded — retry from the station
      setPreviewStatus('idle')
    }
  }

  const cancel = () => {
    abortRef.current?.abort()
  }

  const reset = () => {
    abortRef.current?.abort()
    runIdRef.current += 1
    setFile(null)
    setPhase('idle')
    setError(null)
    setNotice(null)
    clearResult()
  }

  /* ── Pagination: measure each block once at content width, then pack ──
     The measurement container is identical to the page body so the sheet
     and the measure agree on fonts, spacing and table widths. Images carry
     explicit dimensions, so their height is known without waiting. */
  useEffect(() => {
    if (!preview) {
      setPages([])
      return
    }
    let cancelled = false

    const measure = () => {
      if (cancelled) return
      const root = measureRef.current
      if (!root) return
      const heights = new Map<number, number>()
      const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-mblock]'))
      /* Measure the vertical advance between blocks rather than height +
         both margins. Adjacent Word paragraphs collapse their margins, so
         adding both overestimates every block and can push a section that
         fits in Word onto an extra, nearly empty page. */
      const tops = nodes.map(node => node.getBoundingClientRect())
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i]
        const index = Number.parseInt(node.dataset.mblock ?? '', 10)
        if (!Number.isFinite(index)) continue
        const rect = tops[i]
        let advance: number
        if (i + 1 < nodes.length) {
          advance = tops[i + 1].top - rect.top
        } else {
          const cs = getComputedStyle(node)
          advance = rect.height + (Number.parseFloat(cs.marginBottom) || 0)
        }
        heights.set(index, Math.max(0, advance))
      }
      setPages(paginate(preview.blocks, heights, preview.geometry.contentH))
    }

    const raf = requestAnimationFrame(() => requestAnimationFrame(measure))
    let fontsSettled = false
    const afterFonts = () => {
      if (!cancelled && !fontsSettled) {
        fontsSettled = true
        measure()
      }
    }
    if (document.fonts?.ready) void document.fonts.ready.then(afterFonts)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [preview])

  const geometryWidth = preview?.geometry.width ?? PAGE_W

  const applyFit = useCallback(() => {
    const root = deskRef.current
    if (!root) return
    const available = root.clientWidth - 64
    if (available > 0) {
      setZoom(Math.max(0.4, Math.min(1.15, Math.round((available / geometryWidth) * 100) / 100)))
    }
  }, [geometryWidth])

  /* Fit the sheet to the desk when the proof opens and whenever the desk
     changes size — but never after the reader has chosen a zoom level. */
  useEffect(() => {
    if (phase !== 'done' || !preview) return
    const root = deskRef.current
    if (!root) return
    if (!manualZoomRef.current) applyFit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (!manualZoomRef.current) applyFit()
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [phase, preview, pages.length, applyFit])

  /* Active page indicator follows the reader. Observer, not a scroll handler. */
  useEffect(() => {
    if (phase !== 'done' || !preview) return
    const root = deskRef.current
    if (!root) return
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-page]'))
    if (!nodes.length) return
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible) setActivePage(Number.parseInt((visible.target as HTMLElement).dataset.page ?? '0', 10))
      },
      { root, threshold: [0.2, 0.5, 0.8] },
    )
    nodes.forEach(node => observer.observe(node))
    return () => observer.disconnect()
  }, [phase, preview, pages])

  const scrollToPage = useCallback((index: number) => {
    const root = deskRef.current
    if (!root) return
    const target = root.querySelector<HTMLElement>(`[data-page="${index}"]`)
    if (!target) return
    const rootRect = root.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    root.scrollBy({ top: targetRect.top - rootRect.top - 14, behavior: reduce ? 'auto' : 'smooth' })
    setActivePage(index)
  }, [])

  const fitWidth = useCallback(() => {
    manualZoomRef.current = false
    applyFit()
  }, [applyFit])

  const zoomBy = (delta: number) => {
    manualZoomRef.current = true
    setZoom(value => Math.max(0.4, Math.min(1.6, Math.round((value + delta) * 100) / 100)))
  }

  const outline = useMemo(() => {
    if (!preview || !pages.length) return []
    const pageOf = new Map<Block, number>()
    pages.forEach((page, pageIndex) => page.forEach(block => pageOf.set(block, pageIndex)))
    return preview.blocks
      .filter((block): block is Extract<Block, { kind: 'p' }> => block.kind === 'p' && block.heading != null)
      .map(block => ({
        text: plainText(block.segs).slice(0, 90),
        level: Math.min(3, block.heading ?? 1),
        page: pageOf.get(block) ?? 0,
      }))
      .filter(item => item.text.length > 0)
      .slice(0, 40)
  }, [preview, pages])

  const sizeMB = file ? (file.size / 1048576).toFixed(1) : '0'
  const targetName = file ? docxNameFor(file.name) : ''
  const converting = phase === 'converting'
  const pageCount = pages.length
  // docProps/app.xml is often stale in converted files (pdf2docx writes
  // <Words>0</Words> and <Pages>1</Pages>), so only a positive word count is
  // trusted; pages always come from the preview's own pagination.
  const metaWords = preview?.meta.words
  const wordCount = metaWords && metaWords > 0 ? metaWords : preview?.stats.words ?? 0
  const wordsLabel = preview?.truncated ? `${wordCount}+` : `${wordCount}`
  const statusLabel = phase === 'done' ? 'RETYPED' : converting ? 'RETYPING' : 'READY'

  return (
    <>
      <style>{`
        /* ── Local palette (both themes) ───────────────────────
           Frozen coral and live Word blue are the identity. The
           paper itself is always white with fixed ink: that is
           what a Word page is, in either theme. Chrome stays on
           surface-1 tokens. */
        .p2w {
          --p2w-ease: cubic-bezier(0.16, 1, 0.3, 1);
          --p2w-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
          --p2w-blue: #7aaef8;
          --p2w-blue-solid: #2d6be4;
          --p2w-blue-soft: rgba(122, 174, 248, 0.12);
          --p2w-coral: #ff6b6b;
          --p2w-desk: #0d0d12;
          --p2w-desk-grid: rgba(255, 255, 255, 0.035);
          --p2w-desk-label: rgba(255, 255, 255, 0.34);
          --p2w-desk-edge: rgba(255, 255, 255, 0.07);
          --p2w-paper: #ffffff;
          --p2w-ink: #23272f;
          --p2w-ink-soft: #5c6573;
          --p2w-rule: #d6dce6;
          --p2w-rule-strong: #c3ccda;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        [data-theme='light'] .p2w {
          --p2w-blue: #2d6be4;
          --p2w-blue-soft: rgba(45, 107, 228, 0.09);
          --p2w-desk: #e7e4dc;
          --p2w-desk-grid: rgba(40, 36, 28, 0.05);
          --p2w-desk-label: rgba(35, 32, 26, 0.46);
          --p2w-desk-edge: rgba(35, 32, 26, 0.09);
        }

        .p2w :focus-visible {
          outline: 2px solid var(--p2w-blue-solid);
          outline-offset: 2px;
        }

        .p2w-kicker {
          font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
          font-size: 9.5px;
          letter-spacing: 0.16em;
          color: var(--text-faint);
          text-transform: uppercase;
        }
        .p2w-mono {
          font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
          font-variant-numeric: tabular-nums;
        }

        /* ── Empty state: the typesetter's plate ─────────────── */
        .p2w-stage {
          position: relative;
          border: 1px solid var(--border-card);
          border-radius: 16px;
          background:
            linear-gradient(var(--p2w-desk-grid) 1px, transparent 1px) 0 0 / 100% 28px,
            linear-gradient(90deg, var(--p2w-desk-grid) 1px, transparent 1px) 0 0 / 28px 100%,
            var(--bg-card);
          padding: 18px clamp(18px, 3.2vw, 38px) 0;
          overflow: hidden;
          transition: border-color 0.2s, box-shadow 0.25s, background 0.2s;
        }
        .p2w-stage.is-active {
          border-color: var(--p2w-blue-solid);
          box-shadow: 0 0 0 1px var(--p2w-blue-solid), 0 20px 60px -30px rgba(45, 107, 228, 0.55);
        }
        .p2w-crop {
          position: absolute;
          width: 13px;
          height: 13px;
          border-color: var(--text-faint);
          border-style: solid;
          opacity: 0.55;
          pointer-events: none;
        }
        .p2w-crop.tl { top: 11px; left: 11px; border-width: 1px 0 0 1px; }
        .p2w-crop.tr { top: 11px; right: 11px; border-width: 1px 1px 0 0; }
        .p2w-crop.bl { bottom: 11px; left: 11px; border-width: 0 0 1px 1px; }
        .p2w-crop.br { bottom: 11px; right: 11px; border-width: 0 1px 1px 0; }

        .p2w-stage-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 4px 0 14px;
          border-bottom: 1px solid var(--border-base);
        }
        .p2w-stage-head .p2w-kicker { display: inline-flex; align-items: center; gap: 8px; color: var(--text-muted); }
        .p2w-stage-head .p2w-kicker::before {
          content: '';
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--p2w-blue-solid);
          box-shadow: 0 0 0 3px var(--p2w-blue-soft);
        }
        .p2w-stage.is-active .p2w-kicker { color: var(--p2w-blue); }
        .p2w-stage-meta { white-space: nowrap; }

        .p2w-stage-body {
          display: grid;
          grid-template-columns: minmax(0, 1.04fr) minmax(280px, 0.96fr);
          gap: clamp(24px, 4vw, 54px);
          align-items: center;
          padding: clamp(26px, 4vw, 44px) 0 36px;
        }

        .p2w-title {
          margin: 0 0 16px;
          font-family: 'Manrope', sans-serif;
          font-size: clamp(28px, 3.5vw, 42px);
          font-weight: 700;
          line-height: 1.04;
          letter-spacing: -0.035em;
          color: var(--text-primary);
        }
        .p2w-title .w-frozen { color: var(--p2w-coral); }
        .p2w-title .w-live { color: var(--p2w-blue); font-style: normal; }

        .p2w-lede {
          margin: 0 0 22px;
          max-width: 44ch;
          font-size: 14px;
          line-height: 1.65;
          color: var(--text-muted);
          transition: color 0.2s;
        }
        .p2w-stage.is-active .p2w-lede { color: var(--p2w-blue); }

        .p2w-stage-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; }
        .p2w-drag-hint {
          font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
          font-size: 10px;
          letter-spacing: 0.06em;
          color: var(--text-faint);
        }

        .p2w-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          min-height: 42px;
          padding: 0 18px;
          border-radius: 9px;
          border: 1px solid transparent;
          font-family: 'Manrope', sans-serif;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: -0.005em;
          cursor: pointer;
          text-decoration: none;
          transition: transform 0.16s var(--p2w-ease), background 0.16s, box-shadow 0.16s, border-color 0.16s, color 0.16s;
        }
        .p2w-btn svg { flex: 0 0 auto; transition: transform 0.22s var(--p2w-ease); }
        .p2w-btn.is-primary { background: var(--p2w-blue-solid); color: #fff; }
        .p2w-btn.is-primary:hover:not(:disabled) {
          background: #3a78ec;
          transform: translateY(-1px);
          box-shadow: 0 8px 26px -10px rgba(45, 107, 228, 0.75);
        }
        .p2w-btn.is-primary:hover:not(:disabled) svg { transform: translateX(3px); }
        .p2w-btn.is-ghost {
          background: transparent;
          border-color: var(--border-card);
          color: var(--text-secondary);
        }
        .p2w-btn.is-ghost:hover:not(:disabled) { background: var(--bg-item-hover); color: var(--text-primary); }
        .p2w-btn.is-quiet { background: transparent; border-color: transparent; color: var(--text-muted); }
        .p2w-btn.is-quiet:hover:not(:disabled) { background: var(--bg-item-hover); color: var(--text-primary); }
        .p2w-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .p2w-btn.is-busy:disabled { opacity: 1; cursor: progress; }
        .p2w-btn.is-large { min-height: 52px; padding: 0 26px; font-size: 14px; width: 100%; }
        .p2w-btn.is-safe { min-height: 52px; padding: 0 22px; }

        .p2w-orb {
          flex: 0 0 auto;
          filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.25)) drop-shadow(0 0 6px rgba(255, 255, 255, 0.45));
          animation: p2w-orb-in 0.38s var(--p2w-ease-spring) both;
        }
        @keyframes p2w-orb-in { from { opacity: 0; transform: scale(0.4); } to { opacity: 1; transform: none; } }

        .p2w-inline-error {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin: 16px 0 0;
          padding: 10px 12px;
          border: 1px solid rgba(255, 107, 107, 0.28);
          border-radius: 8px;
          background: rgba(255, 107, 107, 0.06);
          color: var(--brand-red);
          font-size: 11.5px;
          line-height: 1.55;
        }
        .p2w-inline-error svg { flex: 0 0 auto; margin-top: 1px; }

        .p2w-facts {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          margin: 0;
          padding: 14px 0 16px;
          list-style: none;
          border-top: 1px solid var(--border-base);
        }
        .p2w-facts li {
          padding: 0 18px;
          border-left: 1px solid var(--border-base);
          font-size: 11.5px;
          line-height: 1.5;
          color: var(--text-muted);
        }
        .p2w-facts li:first-child { padding-left: 0; border-left: 0; }
        .p2w-facts b { display: block; margin-bottom: 2px; font-size: 12px; font-weight: 600; color: var(--text-primary); }

        /* ── The specimen sheet ──────────────────────────────── */
        .p2w-doc { --seam: 40%; position: relative; }
        .p2w-doc-loaded { --seam: 0%; }
        .p2w-doc-sheet {
          position: relative;
          overflow: hidden;
          min-height: 246px;
          padding: 24px 26px 30px;
          border-radius: 5px;
          background: var(--p2w-paper);
          box-shadow: 0 26px 48px -26px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(0, 0, 0, 0.06);
        }
        .p2w-rows { display: flex; flex-direction: column; gap: 9px; }
        .p2w-row {
          display: block;
          width: var(--w, 80%);
          height: 6px;
          border-radius: 1.5px;
          background: rgba(232, 85, 85, 0.24);
        }
        .p2w-row-h { height: 11px; margin-bottom: 7px; background: rgba(232, 85, 85, 0.4); }
        .p2w-live {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: var(--seam);
          overflow: hidden;
          padding: 24px 26px 30px;
          transition: height 0.45s var(--p2w-ease);
        }
        .p2w-live .p2w-row { background: rgba(45, 107, 228, 0.28); }
        .p2w-live .p2w-row-h { background: rgba(45, 107, 228, 0.46); }
        .p2w-ruler {
          position: absolute;
          top: 24px;
          bottom: 28px;
          right: 12px;
          width: 5px;
          background: repeating-linear-gradient(to bottom, rgba(45, 107, 228, 0.26) 0 1px, transparent 1px 8px);
        }
        .p2w-seam {
          position: absolute;
          left: 0;
          right: 0;
          top: var(--seam);
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(45, 107, 228, 0.55) 14%, rgba(45, 107, 228, 0.55) 86%, transparent);
          opacity: 0.65;
          transition: top 0.45s var(--p2w-ease), opacity 0.3s;
        }
        .p2w-caret {
          position: absolute;
          top: var(--seam);
          left: 38%;
          width: 2px;
          height: 15px;
          transform: translateY(-50%);
          background: var(--p2w-blue-solid);
          animation: p2w-blink 1.1s steps(1) infinite;
          transition: top 0.45s var(--p2w-ease), left 0.45s var(--p2w-ease);
        }
        @keyframes p2w-blink { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0; } }

        /* Drag-active: the seam sweeps the whole sheet once — a preview
           of the conversion itself. */
        .p2w-stage.is-active .p2w-doc { --seam: 100%; }

        /* Converting: the retype head descends, indeterminate. */
        .p2w-doc-converting .p2w-live { animation: p2w-retype-h 2.6s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite; }
        .p2w-doc-converting .p2w-seam,
        .p2w-doc-converting .p2w-caret { animation: p2w-retype-t 2.6s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite; }
        @keyframes p2w-retype-h { 0%, 8% { height: 0%; } 86%, 100% { height: 100%; } }
        @keyframes p2w-retype-t { 0%, 8% { top: 0%; } 86%, 100% { top: 100%; } }

        .p2w-specimen { position: relative; }
        .p2w-specimen-caption {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 12px;
        }
        .p2w-specimen-caption .is-frozen { color: var(--p2w-coral); }
        .p2w-specimen-caption .is-live { color: var(--p2w-blue); }

        /* ── Document docket (loaded / converting) ───────────── */
        .p2w-docket {
          border: 1px solid var(--border-card);
          border-radius: 16px;
          background: var(--bg-card);
          overflow: hidden;
          animation: p2w-rise 0.34s var(--p2w-ease) both;
        }
        .p2w-docket.is-active { border-color: var(--p2w-blue-solid); }
        @keyframes p2w-rise {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .p2w-docket-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 13px 22px;
          border-bottom: 1px solid var(--border-base);
        }
        .p2w-state {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
          font-size: 9.5px;
          letter-spacing: 0.14em;
          color: var(--text-muted);
        }
        .p2w-state::before {
          content: '';
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--text-faint);
        }
        .p2w-state.is-live { color: var(--p2w-blue); }
        .p2w-state.is-live::before { background: var(--p2w-blue-solid); box-shadow: 0 0 0 3px var(--p2w-blue-soft); }
        .p2w-state.is-run { color: var(--p2w-blue); }
        .p2w-state.is-run::before { background: var(--p2w-blue-solid); animation: p2w-pulse 1.1s ease-in-out infinite; }
        @keyframes p2w-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }

        .p2w-filegrid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
          align-items: center;
          gap: 16px;
          padding: 20px 22px;
        }
        .p2w-file { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .p2w-file.is-target { justify-content: flex-end; text-align: right; }
        .p2w-file-glyph {
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          width: 40px;
          height: 40px;
          border-radius: 8px;
          font-family: 'Manrope', sans-serif;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.04em;
        }
        .p2w-file-glyph.is-pdf {
          background: rgba(255, 107, 107, 0.1);
          border: 1px solid rgba(255, 107, 107, 0.26);
          color: var(--brand-red);
        }
        .p2w-file-glyph.is-docx {
          background: var(--p2w-blue-soft);
          border: 1px solid rgba(122, 174, 248, 0.3);
          color: var(--p2w-blue);
        }
        [data-theme='light'] .p2w-file-glyph.is-docx { border-color: rgba(45, 107, 228, 0.24); }
        .p2w-file-text { min-width: 0; }
        .p2w-file-name {
          display: block;
          font-size: 12.5px;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .p2w-file-meta {
          display: block;
          margin-top: 3px;
          font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
          font-variant-numeric: tabular-nums;
          font-size: 9.5px;
          letter-spacing: 0.08em;
          color: var(--text-faint);
        }
        .p2w-transfer {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
          flex: 0 0 auto;
          color: var(--p2w-blue);
        }
        .p2w-transfer-line {
          width: 52px;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(122, 174, 248, 0.55), transparent);
        }
        .p2w-transfer-label {
          font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
          font-size: 8px;
          letter-spacing: 0.2em;
          color: var(--text-faint);
        }

        .p2w-docket-paper {
          padding: 0 22px 20px;
          background:
            linear-gradient(var(--p2w-desk-grid) 1px, transparent 1px) 0 0 / 100% 26px,
            linear-gradient(90deg, var(--p2w-desk-grid) 1px, transparent 1px) 0 0 / 26px 100%,
            var(--p2w-desk);
          border-top: 1px solid var(--border-base);
          border-bottom: 1px solid var(--border-base);
        }
        .p2w-docket-paper .p2w-doc { padding-top: 22px; }

        .p2w-docket-foot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
          padding: 12px 22px 14px;
        }
        .p2w-status-line {
          display: flex;
          align-items: center;
          gap: 9px;
          min-width: 0;
          font-size: 11.5px;
          line-height: 1.5;
          color: var(--text-muted);
        }
        .p2w-status-line b { color: var(--text-primary); font-weight: 600; }
        .p2w-status-dot {
          flex: 0 0 auto;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--text-faint);
        }
        .p2w-status-dot.is-live { background: var(--p2w-blue-solid); }
        .p2w-status-dot.is-run { background: var(--p2w-blue-solid); animation: p2w-pulse 1.1s ease-in-out infinite; }

        .p2w-docket-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
        .p2w-ghost {
          border: none;
          border-radius: 7px;
          padding: 6px 9px;
          background: transparent;
          color: var(--text-muted);
          font-size: 11.5px;
          font-weight: 500;
          cursor: pointer;
          transition: color 0.15s, background 0.15s;
        }
        .p2w-ghost:hover { color: var(--text-primary); background: var(--bg-item-hover); }
        .p2w-ghost.is-danger:hover { color: var(--brand-red); background: rgba(255, 107, 107, 0.08); }

        .p2w-toggle {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: none;
          padding: 5px 7px;
          background: transparent;
          cursor: pointer;
        }
        .p2w-toggle-track {
          position: relative;
          flex: 0 0 auto;
          width: 26px;
          height: 15px;
          border-radius: 999px;
          border: 1px solid var(--border-base);
          background: var(--bg-item-hover);
          transition: background 0.2s, border-color 0.2s;
        }
        .p2w-toggle-track::after {
          content: '';
          position: absolute;
          top: 2px;
          left: 2px;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--text-faint);
          transition: transform 0.22s var(--p2w-ease-spring), background 0.2s;
        }
        .p2w-toggle[aria-checked='true'] .p2w-toggle-track {
          border-color: rgba(45, 107, 228, 0.4);
          background: rgba(45, 107, 228, 0.28);
        }
        .p2w-toggle[aria-checked='true'] .p2w-toggle-track::after {
          transform: translateX(11px);
          background: var(--p2w-blue-solid);
        }
        .p2w-toggle-label {
          font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
          font-size: 9.5px;
          letter-spacing: 0.12em;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .p2w-toggle:hover .p2w-toggle-label { color: var(--text-primary); }

        .p2w-error {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          font-size: 11.5px;
          line-height: 1.55;
          color: var(--brand-red);
        }
        .p2w-error span { min-width: 0; }
        .p2w-error .p2w-ghost { margin-left: auto; flex-shrink: 0; color: var(--brand-red); }

        .p2w-actions { display: flex; gap: 10px; align-items: stretch; }
        .p2w-actions .p2w-btn.is-large { flex: 1 1 auto; }
        .p2w-choice-note {
          margin: -6px 2px 0;
          text-align: center;
          font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
          font-size: 9.5px;
          letter-spacing: 0.06em;
          color: var(--text-faint);
        }

        /* ── The proofing desk (done) ─────────────────────────── */
        .p2w-proof {
          border: 1px solid var(--border-card);
          border-radius: 16px;
          background: var(--bg-card);
          overflow: hidden;
          animation: p2w-rise 0.4s var(--p2w-ease) both;
        }
        .p2w-proof-bar {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 16px 22px;
          padding: 13px 18px;
          border-bottom: 1px solid var(--border-base);
        }
        .p2w-proof-id { display: flex; align-items: center; gap: 11px; min-width: 0; flex: 1 1 250px; }
        .p2w-wordmark {
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          width: 40px;
          height: 40px;
          border-radius: 8px;
          background: linear-gradient(160deg, #2d6be4, #2452b8);
          color: #fff;
          font-family: 'Manrope', sans-serif;
          font-size: 16px;
          font-weight: 800;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.26);
        }
        .p2w-proof-name {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .p2w-proof-sub {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 3px;
          font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
          font-size: 9.5px;
          letter-spacing: 0.07em;
          color: var(--text-faint);
        }
        .p2w-proof-sub b { font-weight: 500; color: var(--p2w-blue); }
        .p2w-proof-sub i {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: var(--text-ghost);
        }

        .p2w-proof-stats { display: flex; align-items: center; gap: 22px; flex: 0 0 auto; }
        .p2w-stat { display: flex; flex-direction: column; gap: 2px; }
        .p2w-stat span {
          font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
          font-size: 8.5px;
          letter-spacing: 0.14em;
          color: var(--text-faint);
        }
        .p2w-stat b {
          font-family: 'Manrope', sans-serif;
          font-size: 14px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--text-primary);
          line-height: 1;
        }
        .p2w-proof-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
        .p2w-proof-actions .p2w-btn { min-height: 38px; font-size: 12px; padding: 0 14px; }

        .p2w-proof-body {
          display: grid;
          grid-template-columns: 210px minmax(0, 1fr);
          height: min(76vh, 840px);
          min-height: 480px;
        }

        /* Left rail: page thumbnails and outline. */
        .p2w-rail {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 16px 12px;
          border-right: 1px solid var(--border-base);
          background: var(--bg-item);
          min-width: 0;
          min-height: 0;
          overflow-y: auto;
        }
        .p2w-rail-label {
          padding: 0 4px;
          font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
          font-size: 8.5px;
          letter-spacing: 0.18em;
          color: var(--text-faint);
        }
        .p2w-thumbs { display: flex; flex-direction: column; gap: 10px; }
        .p2w-thumb {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
          padding: 7px 6px 5px;
          border: 1px solid transparent;
          border-radius: 8px;
          background: transparent;
          cursor: pointer;
          transition: background 0.16s, border-color 0.16s;
        }
        .p2w-thumb:hover { background: var(--bg-item-hover); }
        .p2w-thumb[aria-current='true'] { border-color: rgba(45, 107, 228, 0.4); background: var(--p2w-blue-soft); }
        .p2w-thumb-page {
          display: flex;
          flex-direction: column;
          gap: 3px;
          width: 92px;
          aspect-ratio: 1 / 1.414;
          padding: 10px 9px;
          border-radius: 2px;
          background: #fff;
          box-shadow: 0 3px 10px rgba(0, 0, 0, 0.24);
          overflow: hidden;
        }
        .p2w-thumb-line { height: 2px; border-radius: 1px; background: rgba(35, 45, 65, 0.18); }
        .p2w-thumb-line.is-head { height: 4px; background: rgba(35, 45, 65, 0.32); }
        .p2w-thumb-line.is-image { height: 18px; background: rgba(45, 107, 228, 0.14); }
        .p2w-thumb-line.is-table { height: 12px; border: 1px solid rgba(35, 45, 65, 0.18); background: transparent; }
        .p2w-thumb-num {
          font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
          font-size: 8.5px;
          letter-spacing: 0.08em;
          color: var(--text-faint);
          font-variant-numeric: tabular-nums;
        }
        .p2w-thumb[aria-current='true'] .p2w-thumb-num { color: var(--p2w-blue); }

        .p2w-outline { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .p2w-outline-item {
          display: block;
          width: 100%;
          padding: 5px 6px;
          border: none;
          border-radius: 5px;
          background: transparent;
          text-align: left;
          color: var(--text-muted);
          font-size: 11px;
          line-height: 1.4;
          cursor: pointer;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          transition: color 0.14s, background 0.14s;
        }
        .p2w-outline-item:hover { color: var(--text-primary); background: var(--bg-item-hover); }
        .p2w-outline-item.is-l2 { padding-left: 15px; }
        .p2w-outline-item.is-l3 { padding-left: 24px; }
        .p2w-outline-empty {
          padding: 0 6px;
          font-size: 10.5px;
          line-height: 1.5;
          color: var(--text-faint);
        }

        /* Center: the desk and the paper. */
        .p2w-desk {
          position: relative;
          min-width: 0;
          min-height: 0;
          height: 100%;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          background:
            radial-gradient(ellipse at 50% 0%, rgba(122, 174, 248, 0.06), transparent 62%),
            linear-gradient(var(--p2w-desk-grid) 1px, transparent 1px) 0 0 / 100% 24px,
            linear-gradient(90deg, var(--p2w-desk-grid) 1px, transparent 1px) 0 0 / 24px 100%,
            var(--p2w-desk);
        }
        .p2w-desk-scroll {
          flex: 1 1 auto;
          min-height: 0;
          overflow: auto;
          overscroll-behavior: contain;
          padding: 26px 26px 34px;
          scrollbar-width: thin;
          scrollbar-color: var(--p2w-desk-label) transparent;
        }
        .p2w-pages { display: flex; flex-direction: column; align-items: center; gap: 26px; }
        .p2w-page-wrap { display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .p2w-page {
          box-sizing: border-box;
          border-radius: 2px;
          background: var(--p2w-paper);
          color: var(--p2w-ink);
          box-shadow: 0 30px 70px -34px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(0, 0, 0, 0.05);
          animation: p2w-page-in 0.4s var(--p2w-ease) both;
        }
        @keyframes p2w-page-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .p2w-page-tag {
          font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
          font-size: 8.5px;
          letter-spacing: 0.16em;
          color: var(--p2w-desk-label);
          font-variant-numeric: tabular-nums;
        }

        .p2w-laying {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          height: 420px;
          font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
          font-size: 10px;
          letter-spacing: 0.16em;
          color: var(--p2w-desk-label);
        }
        .p2w-laying::before {
          content: '';
          width: 26px;
          height: 26px;
          border-radius: 50%;
          border: 2px solid var(--p2w-desk-edge);
          border-top-color: var(--p2w-blue);
          animation: p2w-spin 0.9s linear infinite;
        }
        @keyframes p2w-spin { to { transform: rotate(360deg); } }

        .p2w-zoom {
          position: absolute;
          right: 18px;
          bottom: 46px;
          display: flex;
          align-items: center;
          gap: 1px;
          padding: 3px;
          border: 1px solid var(--border-card);
          border-radius: 8px;
          background: var(--bg-card);
          box-shadow: 0 8px 24px -12px rgba(0, 0, 0, 0.6);
        }
        .p2w-zoom button {
          display: grid;
          place-items: center;
          min-width: 27px;
          height: 26px;
          padding: 0 6px;
          border: none;
          border-radius: 5px;
          background: transparent;
          color: var(--text-secondary);
          font-size: 13px;
          cursor: pointer;
          transition: background 0.14s, color 0.14s;
        }
        .p2w-zoom button:hover { background: var(--bg-item-hover); color: var(--text-primary); }
        .p2w-zoom button.is-fit {
          font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
          font-size: 8.5px;
          letter-spacing: 0.08em;
          color: var(--text-muted);
        }
        .p2w-zoom-value {
          min-width: 38px;
          text-align: center;
          font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
          font-size: 9.5px;
          font-variant-numeric: tabular-nums;
          color: var(--text-muted);
        }

        .p2w-proof-note {
          margin: 0;
          padding: 9px 18px 11px;
          border-top: 1px solid var(--p2w-desk-edge);
          font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
          font-size: 9px;
          line-height: 1.5;
          letter-spacing: 0.04em;
          color: var(--p2w-desk-label);
        }

        /* Preview could not be reconstructed: page, not an error. */
        .p2w-proof-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          min-height: 460px;
          padding: 40px 24px;
          text-align: center;
          background: var(--p2w-desk);
        }
        .p2w-proof-empty .p2w-wordmark { width: 54px; height: 54px; font-size: 21px; }
        .p2w-proof-empty h3 {
          margin: 4px 0 0;
          font-family: 'Manrope', sans-serif;
          font-size: 18px;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: var(--text-primary);
        }
        .p2w-proof-empty p {
          margin: 0;
          max-width: 42ch;
          font-size: 12.5px;
          line-height: 1.6;
          color: var(--text-muted);
        }

        /* Hidden measurement pass: same width and typography as the sheet. */
        .p2w-measure {
          position: fixed;
          top: 0;
          left: -10000px;
          visibility: hidden;
          pointer-events: none;
          contain: layout style;
        }

        /* ── The page itself: a Word document, not app chrome ──
           Calibri first (Word's default), Carlito as the
           metric-compatible fallback, then the platform UI face. */
        .p2w-page-body {
          font-family: Calibri, Carlito, 'Segoe UI', system-ui, sans-serif;
          font-size: 16px;
          line-height: 1.55;
          color: var(--p2w-ink);
          overflow-wrap: break-word;
        }
        .p2w-doc-p {
          margin: 0 0 8px;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .p2w-doc-p:last-child { margin-bottom: 0; }
        .p2w-doc-p strong { font-weight: 700; }
        .p2w-doc-p u { text-decoration: underline; text-underline-offset: 2px; }

        .p2w-doc-h {
          margin: 18px 0 10px;
          font-weight: 700;
          line-height: 1.22;
          color: #16233c;
          letter-spacing: -0.012em;
        }
        .p2w-doc-h:first-child { margin-top: 0; }
        .p2w-doc-h1 { font-size: 26px; letter-spacing: -0.02em; }
        .p2w-doc-h2 { font-size: 20px; }
        .p2w-doc-h3 { font-size: 16.5px; }
        .p2w-doc-h4,
        .p2w-doc-h5,
        .p2w-doc-h6 { font-size: 14.5px; }
        .p2w-doc-h.is-title { font-size: 30px; letter-spacing: -0.025em; }

        .p2w-doc-li {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          margin: 0 0 4px;
          padding-left: 4px;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .p2w-doc-marker {
          flex: 0 0 18px;
          text-align: right;
          color: #3d4653;
          font-variant-numeric: tabular-nums;
        }
        .p2w-doc-litext { min-width: 0; flex: 1 1 auto; }

        .p2w-doc-tablewrap { margin: 6px 0 14px; max-width: 100%; }
        .p2w-doc-table {
          display: grid;
          border-top: 1px solid var(--p2w-rule);
          border-left: 1px solid var(--p2w-rule);
          font-size: 12.5px;
          line-height: 1.45;
        }
        .p2w-doc-td {
          min-width: 0;
          padding: 3px 8px;
          border-right: 1px solid var(--p2w-rule);
          border-bottom: 1px solid var(--p2w-rule);
          overflow-wrap: anywhere;
          white-space: pre-wrap;
        }
        .p2w-doc-td.is-head { background: #f2f5fa; font-weight: 700; }
        .p2w-doc-td strong { font-weight: 700; }
        .p2w-doc-img {
          display: block;
          max-width: 100%;
          height: auto;
          margin: 8px auto 14px;
          object-fit: contain;
        }

        /* ── Responsive ──────────────────────────────────────── */
        @media (max-width: 980px) {
          .p2w-stage-body { grid-template-columns: 1fr; gap: 30px; }
          .p2w-specimen { max-width: 430px; }
          .p2w-proof-body { grid-template-columns: 1fr; height: auto; min-height: 0; }
          .p2w-rail {
            flex-direction: row;
            align-items: flex-start;
            gap: 12px;
            border-right: 0;
            border-bottom: 1px solid var(--border-base);
            overflow-x: auto;
            overflow-y: hidden;
            padding: 12px 14px;
          }
          .p2w-rail-label { display: none; }
          .p2w-thumbs { flex-direction: row; gap: 8px; }
          .p2w-thumb { flex: 0 0 auto; }
          .p2w-thumb-page { width: 64px; }
          .p2w-outline { display: none; }
        }
        @media (max-width: 720px) {
          .p2w-stage-head { flex-wrap: wrap; gap: 6px; }
          .p2w-stage-meta { white-space: normal; }
          .p2w-filegrid { grid-template-columns: 1fr; gap: 12px; }
          .p2w-file.is-target { justify-content: flex-start; text-align: left; }
          .p2w-transfer { flex-direction: row; gap: 8px; align-self: flex-start; }
          .p2w-transfer-line { width: 34px; }
          .p2w-docket-actions { width: 100%; justify-content: flex-end; }
          .p2w-facts { grid-template-columns: 1fr; padding: 4px 0 10px; }
          .p2w-facts li { padding: 9px 0; border-left: 0; border-top: 1px solid var(--border-base); }
          .p2w-facts li:first-child { border-top: 0; }
          .p2w-proof-stats { gap: 16px; }
          .p2w-proof-actions { width: 100%; justify-content: flex-end; }
          .p2w-desk { height: min(66vh, 620px); }
          .p2w-desk-scroll { padding: 18px 14px 30px; }
          .p2w-actions { flex-direction: column; }
          .p2w-btn.is-safe { width: 100%; }
        }
        @media (max-width: 460px) {
          .p2w-proof-stats { width: 100%; justify-content: space-between; }
          .p2w-proof-actions .p2w-btn { flex: 1 1 auto; }
          .p2w-stage { padding-top: 14px; }
        }

        /* ── Reduced motion: static two-tone, no sweep, no spin ── */
        @media (prefers-reduced-motion: reduce) {
          .p2w-caret { animation: none; }
          .p2w-live,
          .p2w-seam,
          .p2w-caret { transition: none; }
          .p2w-doc-converting .p2w-live,
          .p2w-doc-converting .p2w-seam,
          .p2w-doc-converting .p2w-caret { animation: none; }
          .p2w-doc-converting { --seam: 55%; }
          .p2w-orb { animation: none; }
          .p2w-toggle-track::after { transition: none; }
          .p2w-state.is-run::before,
          .p2w-status-dot.is-run { animation: none; }
          .p2w-docket,
          .p2w-proof,
          .p2w-page { animation: none; }
          .p2w-laying::before { animation: none; border-top-color: var(--p2w-desk-edge); }
          .p2w-btn { transition: none; }
          .p2w-btn.is-primary:hover:not(:disabled) { transform: none; }
        }
      `}</style>

      <div {...getRootProps({ className: 'p2w', tabIndex: -1 })}>
        <input {...getInputProps()} />

        {phase === 'idle' && (
          <section className={`p2w-stage${isDragActive ? ' is-active' : ''}`} aria-label="PDF to Word drop plate">
            <span className="p2w-crop tl" aria-hidden="true" />
            <span className="p2w-crop tr" aria-hidden="true" />
            <span className="p2w-crop bl" aria-hidden="true" />
            <span className="p2w-crop br" aria-hidden="true" />

            <header className="p2w-stage-head">
              <span className="p2w-kicker">The Retype</span>
              <span className="p2w-kicker p2w-stage-meta">PDF → DOCX · up to {MAX_FILE_MB} MB</span>
            </header>

            <div className="p2w-stage-body">
              <div>
                <h1 className="p2w-title">
                  <span className="w-frozen">Frozen</span> in PDF.<br />
                  <span className="w-live">Alive</span> in Word.
                </h1>
                <p className="p2w-lede">
                  {isDragActive
                    ? 'Release to load it into the docket.'
                    : 'Convert a PDF into an editable Word document, then review the result before downloading. Layout, tables and images can change; scanned pages follow an OCR path.'}
                </p>
                <div className="p2w-stage-actions">
                  <button type="button" className="p2w-btn is-primary" onClick={open}>
                    Choose a PDF
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </button>
                  <span className="p2w-drag-hint">
                    {isDragActive ? 'RELEASE TO LOAD' : 'OR DRAG IT ANYWHERE ON THIS PLATE'}
                  </span>
                </div>

                {error && (
                  <p className="p2w-inline-error" role="alert">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="13" />
                      <line x1="12" y1="16.5" x2="12" y2="17.5" />
                    </svg>
                    <span>{error}</span>
                  </p>
                )}
              </div>

              <div className="p2w-specimen">
                <RetypeDoc mode="specimen" />
                <div className="p2w-specimen-caption">
                  <span className="p2w-kicker">Fig. 01 — the seam</span>
                  <span className={`p2w-kicker ${isDragActive ? 'is-live' : 'is-frozen'}`}>{isDragActive ? 'Live' : 'Frozen'}</span>
                </div>
              </div>
            </div>

            <ul className="p2w-facts">
              <li><b>Review the layout</b>Columns, spacing and reading order can change during conversion.</li>
              <li><b>Check table structure</b>Text PDFs may retain editable cells; OCR output may rebuild plain paragraphs.</li>
              <li><b>Scans need OCR</b>Language support depends on installed data. Compare recognized text with the source.</li>
            </ul>
          </section>
        )}

        {file && phase !== 'done' && (
          <>
            <section className={`p2w-docket${isDragActive && !converting ? ' is-active' : ''}`} aria-label="Conversion docket">
              <header className="p2w-docket-head">
                <span className="p2w-kicker">Document docket</span>
                <span className={`p2w-state${converting ? ' is-run' : ''}`}>{statusLabel}</span>
              </header>

              <div className="p2w-filegrid">
                <div className="p2w-file">
                  <span className="p2w-file-glyph is-pdf" aria-hidden="true">PDF</span>
                  <span className="p2w-file-text">
                    <span className="p2w-file-name" title={file.name}>{file.name}</span>
                    <span className="p2w-file-meta">{sizeMB} MB · SOURCE</span>
                  </span>
                </div>

                <div className="p2w-transfer" aria-hidden="true">
                  <span className="p2w-transfer-line" />
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="4" y1="12" x2="20" y2="12" />
                    <polyline points="13 5 20 12 13 19" />
                  </svg>
                  <span className="p2w-transfer-label">{converting ? 'RETYPING' : 'RETYPE'}</span>
                </div>

                <div className="p2w-file is-target">
                  <span className="p2w-file-glyph is-docx" aria-hidden="true">DOCX</span>
                  <span className="p2w-file-text">
                    <span className="p2w-file-name" title={targetName}>{targetName}</span>
                    <span className="p2w-file-meta">EDITABLE · TARGET</span>
                  </span>
                </div>
              </div>

              <div className="p2w-docket-paper">
                <RetypeDoc mode={converting ? 'converting' : 'loaded'} />
              </div>

              <footer className="p2w-docket-foot">
                {error ? (
                  <div className="p2w-error" role="alert">
                    <span>{error}</span>
                    <button className="p2w-ghost" onClick={convert}>Try again</button>
                  </div>
                ) : isDragActive && !converting ? (
                  <div className="p2w-status-line">
                    <span className="p2w-status-dot" aria-hidden="true" />
                    <span>Release to swap in the PDF you are holding.</span>
                  </div>
                ) : converting ? (
                  <div className="p2w-status-line" role="status">
                    <span className="p2w-status-dot is-run" aria-hidden="true" />
                    <span>Rebuilding text, tables and images — long PDFs can take a moment.</span>
                  </div>
                ) : (
                  <div className="p2w-status-line">
                    <span className="p2w-status-dot" aria-hidden="true" />
                    <span>{notice ?? 'Ready to retype — your PDF has not been uploaded yet.'}</span>
                  </div>
                )}

                <div className="p2w-docket-actions">
                  {!converting && (
                    <button
                      className="p2w-toggle"
                      role="switch"
                      aria-checked={autoDownload}
                      title={
                        autoDownload
                          ? 'Auto-save is on: the Word file saves itself the moment conversion finishes.'
                          : 'Auto-save is off: you will proof the converted document first, then download only if you want it.'
                      }
                      onClick={() => setAutoDownload(value => !value)}
                    >
                      <span className="p2w-toggle-track" aria-hidden="true" />
                      <span className="p2w-toggle-label">AUTO-SAVE</span>
                    </button>
                  )}
                  <button className="p2w-ghost" onClick={open} disabled={converting}>Replace</button>
                  <button className="p2w-ghost is-danger" onClick={reset} disabled={converting}>Remove</button>
                </div>
              </footer>
            </section>

            <div className="p2w-actions">
              {converting ? (
                <>
                  <button className="p2w-btn is-primary is-large is-busy" onClick={() => {}} disabled aria-busy="true">
                    <KineticSphere className="p2w-orb" size={24} points={64} dot={0.9} />
                    Retyping your document…
                  </button>
                  <button className="p2w-btn is-ghost is-safe" onClick={cancel}>Cancel</button>
                </>
              ) : (
                <button className="p2w-btn is-primary is-large" onClick={convert}>
                  Convert to Word
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </button>
              )}
            </div>

            {!converting && !autoDownload && !error && (
              <p className="p2w-choice-note">NO DOWNLOAD UNTIL YOU ASK — THE PROOF OPENS FIRST.</p>
            )}
          </>
        )}

        {phase === 'done' && (
          <section className="p2w-proof" aria-label="Converted Word document preview">
            <header className="p2w-proof-bar">
              <div className="p2w-proof-id">
                <span className="p2w-wordmark" aria-hidden="true">W</span>
                <span style={{ minWidth: 0 }}>
                  <span className="p2w-proof-name" title={targetName}>{targetName}</span>
                  <span className="p2w-proof-sub">
                    <b>DOCX</b><i aria-hidden="true" /> editable <i aria-hidden="true" /> converted
                  </span>
                </span>
              </div>

              <div className="p2w-proof-stats" aria-label="Document statistics">
                <div className="p2w-stat">
                  <span>PAGES</span>
                  <b>{previewStatus === 'ready' && pageCount ? pageCount : '—'}</b>
                </div>
                <div className="p2w-stat">
                  <span>WORDS</span>
                  <b>{preview ? wordsLabel : '—'}</b>
                </div>
                <div className="p2w-stat">
                  <span>TABLES</span>
                  <b>{preview ? preview.stats.tables : '—'}</b>
                </div>
              </div>

              <div className="p2w-proof-actions">
                <button
                  className="p2w-btn is-primary"
                  onClick={() => output && downloadBlob(output.blob, output.name)}
                  disabled={!output}
                >
                  Download .docx
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="12" y1="4" x2="12" y2="16" />
                    <polyline points="6 10 12 17 18 10" />
                    <line x1="5" y1="21" x2="19" y2="21" />
                  </svg>
                </button>
                <button className="p2w-btn is-ghost" onClick={reset}>Convert another</button>
              </div>
            </header>

            {previewStatus === 'unavailable' ? (
              <div className="p2w-proof-empty">
                <span className="p2w-wordmark" aria-hidden="true">W</span>
                <h3>Converted. This preview could not be reconstructed.</h3>
                <p>
                  Your Word file is complete — only the in-browser reading of this particular
                  document failed. Download it to inspect the real layout, fonts and pagination.
                </p>
                <button
                  className="p2w-btn is-primary"
                  onClick={() => output && downloadBlob(output.blob, output.name)}
                  disabled={!output}
                >
                  Download .docx
                </button>
              </div>
            ) : previewStatus === 'pending' || !pages.length ? (
              <div className="p2w-proof-empty">
                <div className="p2w-laying">LAYING OUT PAGES</div>
              </div>
            ) : (
              <div className="p2w-proof-body">
                <aside className="p2w-rail" aria-label="Document navigation">
                  <span className="p2w-rail-label">PAGES</span>
                  <div className="p2w-thumbs">
                    {pages.map((page, index) => (
                      <button
                        key={index}
                        type="button"
                        className="p2w-thumb"
                        aria-current={activePage === index ? 'true' : 'false'}
                        aria-label={`Go to page ${index + 1}`}
                        onClick={() => scrollToPage(index)}
                      >
                        <span className="p2w-thumb-page" aria-hidden="true">
                          {thumbLines(page).map((line, i) => (
                            <span
                              key={i}
                              className={`p2w-thumb-line${line.kind === 'image' ? ' is-image' : line.kind === 'table' ? ' is-table' : ''}`}
                              style={{ width: `${line.width}%` }}
                            />
                          ))}
                        </span>
                        <span className="p2w-thumb-num">{index + 1}</span>
                      </button>
                    ))}
                  </div>

                  <span className="p2w-rail-label">OUTLINE</span>
                  {outline.length ? (
                    <nav className="p2w-outline" aria-label="Document outline">
                      {outline.map((item, index) => (
                        <button
                          key={index}
                          type="button"
                          className={`p2w-outline-item is-l${item.level}`}
                          title={item.text}
                          onClick={() => scrollToPage(item.page)}
                        >
                          {item.text}
                        </button>
                      ))}
                    </nav>
                  ) : (
                    <span className="p2w-outline-empty">No headings in this document.</span>
                  )}
                </aside>

                <div className="p2w-desk">
                  <div
                    className="p2w-desk-scroll"
                    ref={deskRef}
                    tabIndex={0}
                    aria-label="Document pages"
                  >
                    <div className="p2w-pages">
                      {pages.map((page, index) => (
                        <PageSheet
                          key={index}
                          page={page}
                          index={index}
                          total={pages.length}
                          zoom={zoom}
                          geometry={preview?.geometry ?? DEFAULT_GEOMETRY}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="p2w-zoom" role="group" aria-label="Preview zoom">
                    <button type="button" onClick={() => zoomBy(-0.1)} aria-label="Zoom out">−</button>
                    <span className="p2w-zoom-value">{Math.round(zoom * 100)}%</span>
                    <button type="button" onClick={() => zoomBy(0.1)} aria-label="Zoom in">+</button>
                    <button type="button" className="is-fit" onClick={fitWidth} aria-label="Fit page to width">FIT</button>
                  </div>

                  <p className="p2w-proof-note">
                    {preview?.truncated
                      ? 'This preview covers the first part of the document — the download holds all of it. '
                      : ''}
                    Reconstructed from the converted DOCX · open the file in Word for exact pagination and fonts.
                  </p>
                </div>
              </div>
            )}

            {preview && (
              <div
                className="p2w-measure"
                aria-hidden="true"
                ref={measureRef}
                style={{ width: preview.geometry.contentW }}
              >
                <div className="p2w-page-body">
                  {preview.blocks.map((block, index) => (
                    <BlockView key={index} block={block} measureIndex={index} />
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  )
}
