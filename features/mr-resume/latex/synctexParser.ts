import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib'
import { assertLatexPath } from './project.ts'
import type { BrowserSyncArtifact, ProofNavigationCandidate, ProofNavigationResult } from './browserSynctex.ts'
import { LATEX_LIMITS, type LatexPdfLocation, type LatexSyncQuery } from './types.ts'

export const SYNCTEX_BYTE_LIMIT = 8 * 1024 * 1024
export const SYNCTEX_RECORD_LIMIT = 32_768
const refuse = (reason: string): ProofNavigationResult => ({ available: false, candidates: [], reason })

/** Only these two compiler-owned roots and literal ./ components are aliases. */
export function synctexSourcePath(raw: string, allowed: ReadonlySet<string>): string | null {
  let path = raw.replace(/^(?:\/job\/|\/work\/project\/)/, '').replace(/^(?:\.\/)+/, '')
  if (path.includes('/./')) path = path.split('/').filter((part) => part !== '.').join('/')
  try { assertLatexPath(path) } catch { return null }
  return allowed.has(path) ? path : null
}

export async function expandSynctex(data: ArrayBuffer): Promise<Uint8Array<ArrayBuffer>> {
  if (!(data instanceof ArrayBuffer) || data.byteLength < 1 || data.byteLength > SYNCTEX_BYTE_LIMIT) throw new Error('The SyncTeX sidecar exceeds its 8 MiB limit.')
  const bytes = new Uint8Array(data)
  if (bytes[0] !== 31 || bytes[1] !== 139) return bytes
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decompress the local SyncTeX map.')
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > SYNCTEX_BYTE_LIMIT) throw new Error('The expanded SyncTeX map exceeds 8 MiB.')
      parts.push(part.value)
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
  const expanded = new Uint8Array(size)
  let offset = 0
  for (const part of parts) { expanded.set(part, offset); offset += part.byteLength }
  return expanded
}

/** Resource/structure gate only. All node decoding and query ranking are upstream C. */
export function validateSynctexEnvelope(bytes: Uint8Array, engine: BrowserSyncArtifact['engine']) {
  if (!bytes.byteLength || bytes.byteLength > SYNCTEX_BYTE_LIMIT) throw new Error('The SyncTeX map is empty or oversized.')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const lines = text.split(/\r?\n/)
  if (lines.length > SYNCTEX_RECORD_LIMIT || lines.some((line) => line.length > 8192) || /[\x00-\x08\x0b-\x1f\x7f]/.test(text)) throw new Error('The SyncTeX map exceeds its record or text bounds.')
  if (lines[0] !== 'SyncTeX Version:1' || !lines.includes(`Output:${engine === 'xelatex' ? 'xdv' : 'pdf'}`)) throw new Error('The SyncTeX map does not match this engine output.')
  const stack: string[] = [], pages = new Set<number>(), tags = new Set<number>()
  let content = false, postamble = false, count = false
  const headers = new Set<string>()
  for (const line of lines.slice(1)) {
    if (!line || line.startsWith('%')) continue
    if (line.startsWith('Input:')) {
      const input = /^Input:([1-9]\d*):(.{1,1024})$/.exec(line)
      if (!input || !Number.isSafeInteger(Number(input[1])) || tags.has(Number(input[1])) || tags.size >= 4096 || postamble) throw new Error('The SyncTeX input table is invalid.')
      tags.add(Number(input[1])); continue
    }
    if (line === 'Content:') {
      if (content || postamble || headers.size !== 5) throw new Error('The SyncTeX preamble is incomplete.')
      content = true; continue
    }
    if (!content) {
      const header = /^(Output|Magnification|Unit|X Offset|Y Offset):(.+)$/.exec(line)
      if (!header || headers.has(header[1])) throw new Error('The SyncTeX preamble is invalid.')
      if (header[1] !== 'Output') {
        const value = Number(header[2])
        if (!/^-?\d+$/.test(header[2]) || !Number.isSafeInteger(value) || Math.abs(value) > 2_147_483_647 || (/^(?:Unit|Magnification)$/.test(header[1]) && value <= 0)) throw new Error('The SyncTeX units or offsets are invalid.')
      }
      headers.add(header[1]); continue
    }
    if (line === 'Postamble:') {
      if (postamble || stack.length || !pages.size) throw new Error('The SyncTeX page tree is incomplete.')
      postamble = true; continue
    }
    if (postamble) {
      if (/^Count:[1-9]\d*$/.test(line) && !count && Number(line.slice(6)) <= SYNCTEX_RECORD_LIMIT) { count = true; continue }
      if (/^!\d+$/.test(line) || line === 'Post scriptum:' || /^(?:Magnification|X Offset|Y Offset):[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:sp|pt|bp|in|cm|mm|pc|dd|cc|nd|nc)?$/.test(line)) continue
      throw new Error('The SyncTeX postamble is invalid.')
    }
    const marker = line[0]
    if ('{<'.includes(marker)) {
      const number = Number(line.slice(1))
      if (!/^[1-9]\d*$/.test(line.slice(1)) || !Number.isSafeInteger(number) || (marker === '{' && (stack.length || number > LATEX_LIMITS.pages || pages.has(number)))) throw new Error('The SyncTeX sheet or form is invalid.')
      if (marker === '{') pages.add(number)
      stack.push(marker)
    } else if ('[('.includes(marker)) {
      if (!stack.length || !/^[[(]\d+,\d+(?:,\d+)?:/.test(line)) throw new Error('The SyncTeX box is invalid.')
      stack.push(marker)
    } else if ('}>)]'.includes(marker)) {
      const opening: Record<string, string> = { '}': '{', '>': '<', ')': '(', ']': '[' }
      if (stack.pop() !== opening[marker] || !/^[}>\])](?:\d+)?$/.test(line)) throw new Error('The SyncTeX tree is unbalanced.')
    } else if (!/^(?:[vhrkg$xcf][0-9,;:+=.\-]+|!\d+)$/.test(line)) {
      throw new Error('The SyncTeX map contains an unsupported record.')
    }
    if (stack.length > 128) throw new Error('The SyncTeX nesting exceeds its limit.')
    for (const number of line.slice(1).matchAll(/-?\d+/g)) if (Math.abs(Number(number[0])) > 2_147_483_647) throw new Error('A SyncTeX coordinate exceeds its integer bounds.')
  }
  if (!content || !postamble || !count || stack.length || !tags.size) throw new Error('The SyncTeX map is incomplete.')
  return pages
}

/** Runs inside the disposable module worker; never fetches or reads source text. */
export async function openSynctex(artifact: BrowserSyncArtifact, pdf: ArrayBuffer) {
  if (artifact.sourceFiles.length > LATEX_LIMITS.files || !artifact.sourceFiles.length) throw new Error('The SyncTeX source allowlist is invalid.')
  const allowed = new Set<string>(), sourceLines = new Map<string, number>()
  for (const file of artifact.sourceFiles) {
    assertLatexPath(file.path)
    if (allowed.has(file.path) || !Number.isSafeInteger(file.lines) || file.lines < 1 || file.lines > 200_000) throw new Error('The SyncTeX source allowlist is invalid.')
    allowed.add(file.path); sourceLines.set(file.path, file.lines)
  }
  const expanded = await expandSynctex(artifact.data), sheets = validateSynctexEnvelope(expanded, artifact.engine)
  // Real LuaHBTeX corpus proves these records can make upstream edit_query choose
  // a different line or a whole-column node. Do not guess a corrected coordinate.
  if (artifact.engine === 'lualatex' && /^x\d+,\d+(?:,\d+)?:-?\d+,0\r?$/m.test(new TextDecoder().decode(expanded))) throw new Error('This LuaHBTeX map has zero-Y glyph boundaries; safe source navigation is unavailable for this proof.')
  if (pdf.byteLength < 1 || pdf.byteLength > LATEX_LIMITS.pdfBytes) throw new Error('The SyncTeX PDF exceeds its bounds.')
  const document = await PDFDocument.load(pdf, { updateMetadata: false, throwOnInvalidObject: true })
  const pages = document.getPages().map((page) => {
    const media = page.getMediaBox(), crop = page.getCropBox(), unit = page.node.get(PDFName.of('UserUnit'))
    // Viewport rotation/zoom is already undone by proofPoint. Intrinsic PDF
    // transforms not attested by the TeX sidecar are refused, never guessed.
    if (page.getRotation().angle % 360 || media.x || media.y || (unit && (!(unit instanceof PDFNumber) || unit.asNumber() !== 1))
      || ['x', 'y', 'width', 'height'].some((key) => Math.abs(media[key as keyof typeof media] - crop[key as keyof typeof crop]) > 0.01)
      || ![media.width, media.height].every((number) => Number.isFinite(number) && number > 0 && number <= 14_400)) throw new Error('Source navigation is unavailable for this PDF crop, origin, rotation, or page unit.')
    return media
  })
  if (!pages.length || pages.length > LATEX_LIMITS.pages || sheets.size !== pages.length || pages.some((_, index) => !sheets.has(index + 1))) throw new Error('The SyncTeX map does not match the final PDF pages.')
  if (!(artifact.parser instanceof ArrayBuffer) || artifact.parser.byteLength > 2 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(artifact.parserSha256)) throw new Error('The pinned SyncTeX parser is unavailable.')
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', artifact.parser)), (byte) => byte.toString(16).padStart(2, '0')).join('')
  if (digest !== artifact.parserSha256) throw new Error('The SyncTeX parser failed its pinned byte check.')
  let writes = 0
  const memory = () => result.instance.exports.memory as WebAssembly.Memory
  const view = () => new DataView(memory().buffer)
  const denied = () => 8
  const result = await WebAssembly.instantiate(artifact.parser, { wasi_snapshot_preview1: {
    environ_get: () => 0,
    environ_sizes_get: (count: number, size: number) => { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return 0 },
    fd_close: () => 0, fd_prestat_get: denied, fd_prestat_dir_name: denied, fd_seek: denied, path_rename: denied,
    fd_fdstat_get: (_fd: number, at: number) => { new Uint8Array(memory().buffer, at, 24).fill(0); view().setUint8(at, 2); return 0 },
    fd_write: (_fd: number, iov: number, count: number, at: number) => {
      let size = 0
      if (count > 1024) throw new Error('The SyncTeX parser log exceeded its bound.')
      for (let i = 0; i < count; i++) size += view().getUint32(iov + i * 8 + 4, true)
      writes += size
      if (writes > 16_384) throw new Error('The SyncTeX parser refused this map.')
      view().setUint32(at, size, true); return 0
    },
    // libc uses this for its internal hash seed, not for security or source IDs.
    random_get: (at: number, size: number) => { new Uint8Array(memory().buffer, at, size).fill(0); return 0 },
    proc_exit: () => { throw new Error('The upstream SyncTeX parser stopped.') },
  } })
  const exports = result.instance.exports
  const call = (name: string, ...args: number[]) => {
    const fn = exports[name]
    if (typeof fn !== 'function') throw new Error('The pinned SyncTeX parser API is invalid.')
    return Number(fn(...args))
  }
  call('_initialize')
  const pointer = call('malloc', expanded.byteLength)
  if (!pointer) throw new Error('The SyncTeX parser memory limit was reached.')
  let scanner = 0
  try { new Uint8Array(memory().buffer, pointer, expanded.byteLength).set(expanded); scanner = call('mr_synctex_load', pointer, expanded.byteLength) }
  finally { call('free', pointer) }
  if (!scanner || writes || call('mr_synctex_node_count', scanner) < 1) throw new Error('The upstream SyncTeX parser could not accept this bounded map.')
  const string = (pointer: number) => {
    const bytes = new Uint8Array(memory().buffer), end = bytes.indexOf(0, pointer)
    if (pointer <= 0 || end < pointer || end - pointer > 1024) return ''
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(pointer, end))
  }
  const tags = new Map<number, string>(), pathTags = new Map<string, number[]>()
  let inputs = 0
  for (let node = call('synctex_scanner_input', scanner); node; node = call('synctex_node_sibling', node)) {
    if (++inputs > 4096) throw new Error('The upstream SyncTeX input table exceeds its bound.')
    const tag = call('synctex_node_tag', node), path = synctexSourcePath(string(call('synctex_scanner_get_name', scanner, tag)), allowed)
    if (path) { tags.set(tag, path); pathTags.set(path, [...(pathTags.get(path) ?? []), tag]) }
  }
  if (!tags.size) throw new Error('The SyncTeX map contains no captured project source paths.')
  return {
    close() { if (scanner) { call('synctex_scanner_free', scanner); scanner = 0 } },
    query(query: LatexSyncQuery): ProofNavigationResult {
      const inverse = query.direction === 'inverse'
      if (inverse) {
        const page = pages[(query.page ?? 0) - 1]
        if (!page || ![query.x, query.y].every((value) => typeof value === 'number' && Number.isFinite(value)) || query.x! < 0 || query.x! > page.width || query.y! < 0 || query.y! > page.height) return refuse('The selected point is outside the compiled PDF page.')
        if (call('synctex_edit_query', scanner, query.page!, query.x!, page.height - query.y!) <= 0) return refuse('No source location is mapped at this point.')
      } else {
        if (!query.file || !query.line || query.line > (sourceLines.get(query.file) ?? 0) || !pathTags.has(query.file)) return refuse('This source line is not part of the captured map.')
        const tag = pathTags.get(query.file)![0]
        if (call('synctex_display_query', scanner, call('synctex_scanner_get_name', scanner, tag), query.line, 0, 0) <= 0) return refuse('No PDF location is mapped for this source line.')
      }
      const candidates = new Map<string, ProofNavigationCandidate>()
      let results = 0
      for (let node = call('synctex_scanner_next_result', scanner); node; node = call('synctex_scanner_next_result', scanner)) {
        if (++results > 128) return refuse('This source mapping is too ambiguous to navigate safely.')
        const file = tags.get(call('synctex_node_tag', node)), line = call('synctex_node_line', node), column = call('synctex_node_column', node), page = call('synctex_node_page', node), geometry = pages[page - 1]
        if (!file || !Number.isSafeInteger(line) || line < 1 || line > sourceLines.get(file)! || !geometry || (!inverse && (file !== query.file || line !== query.line))) continue
        const x = call('synctex_node_box_visible_h', node), baseline = call('synctex_node_box_visible_v', node), width = call('synctex_node_box_visible_width', node)
        // LuaHBTeX can emit zero-Y boundary nodes. Upstream's expanded visible
        // box can then cover unrelated lines. Intersect with its real TeX box,
        // using upstream's final unit/magnification, and refuse inconsistent hits.
        const unit = call('synctex_scanner_magnification', scanner)
        const height = Math.min(call('synctex_node_box_visible_height', node), call('synctex_node_box_height', node) * unit)
        const depth = Math.min(call('synctex_node_box_visible_depth', node), call('synctex_node_box_depth', node) * unit)
        const location: LatexPdfLocation = { page, x: Math.min(x, x + width), y: geometry.height - baseline - depth, width: Math.abs(width), height: height + depth }
        if (!Object.values(location).every(Number.isFinite) || location.width! <= 0 || location.height! <= 0 || location.x < -0.5 || location.y < -0.5 || location.x + location.width! > geometry.width + 0.5 || location.y + location.height! > geometry.height + 0.5) continue
        // Upstream edit_query also offers nearest nodes in the margin. Keep its
        // ranked candidates only if their actual visible box contains the hit.
        if (inverse && (page !== query.page || query.x! < location.x - 0.5 || query.x! > location.x + location.width! + 0.5 || query.y! < location.y - 0.5 || query.y! > location.y + location.height! + 0.5)) continue
        const key = `${file}\0${line}\0${column}`
        const candidate = candidates.get(key) ?? { file, line, ...(Number.isSafeInteger(column) && column > 0 ? { column } : {}), locations: [] }
        if (!candidate.locations.some((prior) => JSON.stringify(prior) === JSON.stringify(location))) candidate.locations.push(location)
        candidates.set(key, candidate)
        if (candidates.size > 32) return refuse('This source mapping is too ambiguous to navigate safely.')
      }
      if (writes) return refuse('The upstream SyncTeX parser refused this query.')
      return candidates.size ? { available: true, candidates: [...candidates.values()] } : refuse(inverse ? 'No captured source is mapped in this whitespace or output region.' : 'This exact source line has no mapped PDF location.')
    },
  }
}
