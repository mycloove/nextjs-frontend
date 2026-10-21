import type { DiagramEngine } from './types'
import { isDiagramLanguage, parseDiagramFences } from './fence-parser'

export interface NormalizedDiagramPaste {
  engine: DiagramEngine
  language: string
  markdown: string
  source: string
}

const LANGUAGE_ENGINES: Record<string, DiagramEngine> = {
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

const MERMAID_START_RE = /^(?:---[\s\S]*?---\s*)?(?:%%\{[\s\S]*?\}%%\s*)?(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|zenuml|sankey-beta|xychart-beta|block-beta|packet-beta|architecture-beta|kanban)\b/i

function cleanClipboardText(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B\u200C\u200D\u2060]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .trim()
}

function engineForLanguage(language: string): DiagramEngine | null {
  return LANGUAGE_ENGINES[language.trim().toLowerCase()] ?? null
}

function infoUsesKroki(info: string): boolean {
  const match = info.match(/\bkroki\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s}]+))/i)
  if (!match) return false
  const value = (match[1] ?? match[2] ?? match[3] ?? '').trim().toLowerCase()
  return Boolean(value) && value !== 'false'
}

function chooseFence(source: string): string {
  const longestRun = Math.max(0, ...Array.from(source.matchAll(/`+/g), (match) => match[0].length))
  return '`'.repeat(Math.max(3, longestRun + 1))
}

function splitTopLevelSemicolons(source: string, targetCurlyDepth = 0): string {
  if (source.includes('\n') || !source.includes(';')) return source

  let quote = ''
  let escaped = false
  let squareDepth = 0
  let roundDepth = 0
  let curlyDepth = 0
  let output = ''

  for (const character of source) {
    if (escaped) {
      output += character
      escaped = false
      continue
    }
    if (character === '\\' && quote) {
      output += character
      escaped = true
      continue
    }
    if (quote) {
      output += character
      if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      output += character
      continue
    }

    if (character === '[') squareDepth += 1
    else if (character === ']') squareDepth = Math.max(0, squareDepth - 1)
    else if (character === '(') roundDepth += 1
    else if (character === ')') roundDepth = Math.max(0, roundDepth - 1)
    else if (character === '{') curlyDepth += 1
    else if (character === '}') curlyDepth = Math.max(0, curlyDepth - 1)

    output += character
    if (character === ';' && squareDepth === 0 && roundDepth === 0 && curlyDepth === targetCurlyDepth) {
      output += '\n'
    }
  }

  return output.trimEnd()
}

function formatGraphviz(source: string): string {
  if (source.includes('\n')) return source
  const opening = source.indexOf('{')
  const closing = source.lastIndexOf('}')
  if (opening < 0 || closing <= opening) return source
  const header = source.slice(0, opening + 1).trimEnd()
  const body = splitTopLevelSemicolons(source.slice(opening + 1, closing).trim())
  const footer = source.slice(closing).trimStart()
  return `${header}\n${body}\n${footer}`
    .split('\n')
    .map((line, index, lines) => index > 0 && index < lines.length - 1 ? `  ${line.trim()}` : line.trim())
    .join('\n')
}

function formatObjectLiteral(source: string): string {
  if (source.includes('\n')) return source

  let quote = ''
  let escaped = false
  let depth = 0
  let output = ''
  const indent = () => '  '.repeat(Math.max(0, depth))

  for (const character of source) {
    if (escaped) {
      output += character
      escaped = false
      continue
    }
    if (character === '\\' && quote) {
      output += character
      escaped = true
      continue
    }
    if (quote) {
      output += character
      if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      output += character
      continue
    }
    if (character === '{' || character === '[') {
      depth += 1
      output += `${character}\n${indent()}`
      continue
    }
    if (character === '}' || character === ']') {
      depth = Math.max(0, depth - 1)
      output = `${output.trimEnd()}\n${indent()}${character}`
      continue
    }
    if (character === ',') {
      output += `,\n${indent()}`
      continue
    }
    output += character
  }

  return output
}

function formatMermaid(source: string): string {
  let formatted = splitTopLevelSemicolons(source)
  if (!source.includes('\n') && formatted.includes('\n')) {
    formatted = formatted.split('\n').map((line) => line.trimStart()).join('\n')
  }
  if (!formatted.includes('\n')) {
    formatted = formatted.replace(
      /^(\s*(?:%%\{[\s\S]*?\}%%\s*)?(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR))\s+/i,
      '$1\n',
    )
    formatted = formatted.replace(
      /^(\s*(?:sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|zenuml|sankey-beta|xychart-beta|block-beta|packet-beta|architecture-beta|kanban))\s+/i,
      '$1\n',
    )
  }
  return formatted
}

function formatJsonDiagram(source: string): string {
  try {
    return JSON.stringify(JSON.parse(source), null, 2)
  } catch {
    return source
  }
}

function formatDiagramSource(source: string, engine: DiagramEngine): string {
  const normalized = cleanClipboardText(source)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')

  if (engine === 'mermaid') return formatMermaid(normalized)
  if (engine === 'vega' || engine === 'vega-lite' || engine === 'plotly') {
    return formatJsonDiagram(normalized)
  }
  if (engine === 'wavedrom' || engine === 'bitfield') {
    const json = formatJsonDiagram(normalized)
    return json === normalized ? formatObjectLiteral(normalized) : json
  }
  if (engine === 'graphviz') return formatGraphviz(normalized)
  if (engine === 'd2') return splitTopLevelSemicolons(normalized)
  return normalized
}

function detectJsonEngine(source: string): DiagramEngine | null {
  try {
    const parsed = JSON.parse(source) as Record<string, unknown>
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return null
    const schema = typeof parsed.$schema === 'string' ? parsed.$schema.toLowerCase() : ''
    if (schema.includes('vega-lite')) return 'vega-lite'
    if (schema.includes('/vega/')) return 'vega'
    if (Array.isArray(parsed.signal)) return 'wavedrom'
    if (Array.isArray(parsed.reg)) return 'bitfield'
    if (isPlotlyData(parsed.data)) return 'plotly'
  } catch {
    return null
  }
  return null
}

function isPlotlyData(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false
  const traceKeys = new Set(['x', 'y', 'z', 'type', 'mode', 'labels', 'values', 'name'])
  return value.every((trace) => (
    Boolean(trace)
    && !Array.isArray(trace)
    && typeof trace === 'object'
    && Object.keys(trace as Record<string, unknown>).some((key) => traceKeys.has(key))
  ))
}

function looksLikeRawD2(source: string): boolean {
  if (/^(?:direction\s*:\s*(?:up|down|left|right)|vars\s*:)/im.test(source)) return true

  const meaningfulLines = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  if (meaningfulLines.length === 0) return false

  const d2Edge = /^(?:[\w.-]+|"[^"]+")(?:\s*\.\s*(?:[\w.-]+|"[^"]+"))*\s*(?:<?->|--|<-|->)\s*(?:[\w.-]+|"[^"]+")/
  return meaningfulLines.some((line) => d2Edge.test(line))
}

function detectRawDiagram(source: string): { engine: DiagramEngine; language: string } | null {
  if (MERMAID_START_RE.test(source)) return { engine: 'mermaid', language: 'mermaid' }
  if (/^@startuml\b/i.test(source)) return { engine: 'plantuml', language: 'plantuml' }
  if (/^(?:strict\s+)?(?:di)?graph\s+(?:[A-Za-z_][\w-]*\s*)?\{/i.test(source)) {
    return { engine: 'graphviz', language: 'graphviz' }
  }
  if (/^\\begin\s*\{tikzpicture\}/i.test(source)) return { engine: 'tikz', language: 'tikz' }
  if (looksLikeRawD2(source)) {
    return { engine: 'd2', language: 'd2' }
  }
  if (/^\{\s*(?:["']?signal["']?)\s*:/i.test(source)) return { engine: 'wavedrom', language: 'wavedrom' }
  if (/^\{\s*(?:["']?reg["']?)\s*:/i.test(source)) return { engine: 'bitfield', language: 'bitfield' }

  const jsonEngine = detectJsonEngine(source)
  return jsonEngine ? { engine: jsonEngine, language: jsonEngine } : null
}

function normalizeFencedDiagram(source: string): NormalizedDiagramPaste | null {
  const parsedBlocks = parseDiagramFences(source)
  const multiline = parsedBlocks.length === 1 ? parsedBlocks[0] : null
  if (multiline && multiline.start === 0 && multiline.end === source.length) {
    const openingEnd = source.indexOf('\n')
    const opening = source.slice(0, openingEnd).match(/^ {0,3}(?:`{3,}|~{3,})(.*)$/)
    if (!opening) return null

    const info = opening[1].trim()
    const formatted = formatDiagramSource(multiline.source, multiline.engine)
    const fence = chooseFence(formatted)
    return {
      engine: multiline.engine,
      language: multiline.language,
      source: formatted,
      markdown: `${fence}${info}\n${formatted}\n${fence}`,
    }
  }

  const compact = source.match(/^(`{3,}|~{3,})[ \t]*([A-Za-z][\w+-]*)([ \t]+\{[^}]*\})?[ \t]+([\s\S]*?)[ \t]*\1$/)
  if (!compact) return null
  const language = compact[2].toLowerCase()
  const attributes = compact[3]?.trim() ?? ''
  const engine = infoUsesKroki(attributes) ? 'kroki' : engineForLanguage(language)
  if (!engine || (engine !== 'kroki' && !isDiagramLanguage(language))) return null
  const formatted = formatDiagramSource(compact[4], engine)
  const fence = chooseFence(formatted)
  return {
    engine,
    language,
    source: formatted,
    markdown: `${fence}${language}${attributes ? ` ${attributes}` : ''}\n${formatted}\n${fence}`,
  }
}

export function normalizeDiagramClipboardText(value: string): NormalizedDiagramPaste | null {
  const source = cleanClipboardText(value)
  if (!source) return null

  const fenced = normalizeFencedDiagram(source)
  if (fenced) return fenced

  // A fence that did not consume the complete clipboard value is Markdown prose,
  // not raw diagram syntax. Avoid heuristics wrapping the whole payload as D2.
  if (/^ {0,3}(?:`{3,}|~{3,})/.test(source)) return null

  const detected = detectRawDiagram(source)
  if (!detected) return null
  const formatted = formatDiagramSource(source, detected.engine)
  const fence = chooseFence(formatted)
  return {
    ...detected,
    source: formatted,
    markdown: `${fence}${detected.language}\n${formatted}\n${fence}`,
  }
}

export function isSelectionInsideDiagramFence(markdown: string, start: number, end: number): boolean {
  if (start < 0 || end < start || end > markdown.length) return false
  return parseDiagramFences(markdown).some((block) => {
    const sourceStart = markdown.indexOf('\n', block.start) + 1
    const closingStart = markdown.lastIndexOf('\n', block.end - 1) + 1
    return sourceStart > block.start && closingStart > sourceStart && sourceStart <= start && closingStart > end
  })
}