import type { DiagramAttributes, DiagramBlock, DiagramEngine } from './types'

const ENGINE_ALIASES: Record<string, DiagramEngine> = {
  mermaid: 'mermaid',
  puml: 'plantuml',
  plantuml: 'plantuml',
  wavedrom: 'wavedrom',
  bitfield: 'bitfield',
  dot: 'graphviz',
  viz: 'graphviz',
  graphviz: 'graphviz',
  d2: 'd2',
  tikz: 'tikz',
  wsd: 'wsd',
  vega: 'vega',
  'vega-lite': 'vega-lite',
  vegalite: 'vega-lite',
  kroki: 'kroki',
  ditaa: 'ditaa',
  plotly: 'plotly',
}

const SAFE_KEYS = new Set([
  'align', 'engine', 'filename', 'kroki', 'layout', 'theme', 'sketch',
  'code_block', 'texPackages', 'tex_packages', 'tikzLibraries',
  'tikz_libraries', 'addToPreamble', 'add_to_preamble', 'showConsole',
  'show_console', 'embedFontCss', 'embed_font_css', 'fontCssUrl',
  'font_css_url',
])

const ATTR_RE = /([A-Za-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s}]+))/g
const OPENING_FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/
const CLOSING_FENCE_RE = /^( {0,3})(`{3,}|~{3,})[ \t]*$/
const VEGA_SCHEMA_RE = /["']?\$schema["']?\s*:\s*["'][^"']*\/schema\/(vega-lite|vega)\/v\d+(?:\.\d+)?\.json["']/i

function parseBoolean(value: string): boolean | string {
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

function parseAttributes(info: string): DiagramAttributes {
  const attributes: DiagramAttributes = {}
  const braces = info.match(/\{([^}]*)\}/)
  if (!braces) return attributes

  for (const match of braces[1].matchAll(ATTR_RE)) {
    const key = match[1]
    if (!SAFE_KEYS.has(key)) continue
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    attributes[key] = parseBoolean(value)
  }
  return attributes
}

function normalizeLanguage(info: string): string {
  return info.replace(/\{[^}]*\}/g, '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

function inferSchemaEngine(source: string): DiagramEngine | undefined {
  const match = source.match(VEGA_SCHEMA_RE)
  if (!match) return undefined
  return match[1].toLowerCase() === 'vega-lite' ? 'vega-lite' : 'vega'
}

function hashDiagramIdentity(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function parseDiagramFences(markdown: string): DiagramBlock[] {
  const blocks: DiagramBlock[] = []
  let cursor = 0
  let index = 0

  while (cursor < markdown.length) {
    const lineEnd = markdown.indexOf('\n', cursor)
    const nextLine = lineEnd === -1 ? markdown.length : lineEnd + 1
    const line = markdown.slice(cursor, lineEnd === -1 ? markdown.length : lineEnd).replace(/\r$/, '')
    const opening = line.match(OPENING_FENCE_RE)
    if (!opening || (opening[2][0] === '`' && opening[3].includes('`'))) {
      cursor = nextLine
      continue
    }

    const fenceCharacter = opening[2][0]
    const fenceLength = opening[2].length
    const info = opening[3]
    const sourceStart = nextLine
    let closingStart = -1
    let closingEnd = -1
    let searchCursor = nextLine

    while (searchCursor < markdown.length) {
      const candidateEnd = markdown.indexOf('\n', searchCursor)
      const candidateNext = candidateEnd === -1 ? markdown.length : candidateEnd + 1
      const candidate = markdown
        .slice(searchCursor, candidateEnd === -1 ? markdown.length : candidateEnd)
        .replace(/\r$/, '')
      const closing = candidate.match(CLOSING_FENCE_RE)
      if (closing && closing[2][0] === fenceCharacter && closing[2].length >= fenceLength) {
        closingStart = searchCursor
        closingEnd = candidateEnd === -1 ? markdown.length : candidateEnd
        cursor = candidateNext
        break
      }
      searchCursor = candidateNext
    }

    // An unclosed fence is ordinary Markdown source and must not consume the rest of the document.
    if (closingStart < 0) {
      cursor = nextLine
      continue
    }

    const source = markdown
      .slice(sourceStart, closingStart)
      .replace(/\r\n/g, '\n')
      .replace(/\n$/, '')
    const language = normalizeLanguage(info)
    const attributes = parseAttributes(info)
    const kroki = attributes.kroki
    const engine = kroki === true || (typeof kroki === 'string' && kroki.length > 0)
      ? 'kroki'
      : ENGINE_ALIASES[language] ?? inferSchemaEngine(source)
    if (!engine) continue

    blocks.push({
      id: `diagram-${index++}-${hashDiagramIdentity(`${engine}\u0000${source}\u0000${JSON.stringify(attributes)}`)}`,
      engine,
      language,
      source,
      attributes,
      start: cursorForBlock(markdown, sourceStart, opening[0]),
      end: closingEnd,
    })
  }
  return blocks
}

function cursorForBlock(markdown: string, sourceStart: number, openingLine: string): number {
  const lineEndingLength = markdown.slice(0, sourceStart).endsWith('\r\n') ? 2 : 1
  return sourceStart - openingLine.length - lineEndingLength
}

export function isDiagramLanguage(language: string): boolean {
  return Boolean(ENGINE_ALIASES[language.trim().toLowerCase()])
}
