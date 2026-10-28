/* Shared utilities for PDF → Markdown premium UI. */

import { extractMath, restoreMathTokens } from './math.ts'
import type { ExtractionReview } from './review/model.ts'
// Syntax highlighting: core build + explicitly registered languages keeps the
// bundle small (the full highlight.js build is ~1MB). Rendered markup uses
// hljs-* classes colored by the workspace theme in 02-workspace-layout.css,
// so dark and light both work without importing a fixed theme.
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import sql from 'highlight.js/lib/languages/sql'
import diff from 'highlight.js/lib/languages/diff'
import java from 'highlight.js/lib/languages/java'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import php from 'highlight.js/lib/languages/php'
import ruby from 'highlight.js/lib/languages/ruby'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import markdown from 'highlight.js/lib/languages/markdown'
import yaml from 'highlight.js/lib/languages/yaml'
import http from 'highlight.js/lib/languages/http'
import tex from 'highlight.js/lib/languages/latex'

const HLJS = hljs as unknown as {
  registerLanguage: (name: string, lang: unknown) => void
  getLanguage: (name: string) => unknown
  highlight: (code: string, opts: { language: string; ignoreIllegals?: boolean }) => { value: string }
}

/**
 * hljs grammars leave bare arithmetic operators (=, +, <, …) as plain text.
 * Wrap them in hljs-operator spans — but only in plain segments, never inside
 * hljs-tag markup, and never inside strings/comments/quotes where an operator
 * character is just content. Operators glued into identifiers on both sides
 * (e.g. the hyphen in "justify-content") are left alone.
 */
const wrapOperators = (html: string): string => {
  const spanStack: boolean[] = []
  return html
    .split(/(<span\b[^>]*>|<\/span>)/g)
    .map((segment) => {
      if (/^<span\b/.test(segment)) {
        spanStack.push(true)
        return segment
      }
      if (segment === '</span>') { spanStack.pop(); return segment }
      // only top-level plain text is wrapped — anything inside a span is
      // already classified (prevents double-nested operator spans)
      if (spanStack.length) return segment
      return segment.replace(/(&lt;|&gt;|[=+*/%<!]+)/g, (match: string, _g: string, offset: number, source: string) => {
        const prev = source[offset - 1] ?? ' '
        const next = source[offset + match.length] ?? ' '
        if (/[\w$]/.test(prev) && /[\w$]/.test(next)) return match
        return `<span class="hljs-operator">${match}</span>`
      })
    })
    .join('')
}

/** Common SQL keywords missing from hljs's SQL grammar (render as plain text). */
const SQL_EXTRA_KEYWORDS = /\b(LIMIT|OFFSET|AUTO_INCREMENT|SIGNED|UNSIGNED)\b/g
const patchSqlKeywords = (html: string): string => {
  const spanStack: boolean[] = []
  return html
    .split(/(<span\b[^>]*>|<\/span>)/g)
    .map((segment) => {
      if (/^<span\b/.test(segment)) { spanStack.push(true); return segment }
      if (segment === '</span>') { spanStack.pop(); return segment }
      if (spanStack.length) return segment
      return segment.replace(SQL_EXTRA_KEYWORDS, '<span class="hljs-keyword">$1</span>')
    })
    .join('')
}
const LANGS: Array<[string, unknown]> = [
  ['javascript', javascript],
  ['typescript', typescript],
  ['python', python],
  ['css', css],
  ['xml', xml],
  ['json', json],
  ['bash', bash],
  ['sql', sql],
  ['diff', diff],
  ['java', java],
  ['go', go],
  ['rust', rust],
  ['php', php],
  ['ruby', ruby],
  ['c', c],
  ['cpp', cpp],
  ['csharp', csharp],
  ['markdown', markdown],
  ['yaml', yaml],
  ['http', http],
  ['latex', tex],
]
for (const [name, lang] of LANGS) HLJS.registerLanguage(name, lang)

/** Common aliases → registered hljs language names. */
const HL_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  html: 'xml',
  htm: 'xml',
  vue: 'xml',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  cs: 'csharp',
  tex: 'latex',
  latex: 'latex',
}

export type Mode = 'standard' | 'tables' | 'ocr'

export type JobStatus = 'idle' | 'converting' | 'done' | 'error' | 'password'

export interface Job {
  id: string
  file: File
  /** User-facing Markdown name, independent of the original upload filename. */
  title: string
  status: JobStatus
  progress: number
  markdown: string
  html: string
  confidence: number
  stats: {
    headings: number
    lists: number
    codeBlocks: number
    tables: number
    links: number
    words: number
    tokens: number
  }
  password?: string
  passwordAttempts: number
  error?: string
  pages?: number
  processedAt?: number
  aiActions: Record<string, boolean>
  /** Review metadata is serializable; original PDF bytes are session-local only. */
  extractionReview?: ExtractionReview
  sourcePdf?: File
  /**
   * Provenance key for a document that came from somewhere specific (today: a
   * GitHub file, `github:owner/repo@branch:path`). It is what lets a second
   * "Open in Mr. Markdown" on the same file focus the document already open
   * instead of cloning it. Absent for uploads and merges, which have no source.
   */
  sourceId?: string
  /**
   * GitHub baseline: the content this document was read (or last committed) at,
   * plus the blob sha at that point. "Edited" is a plain comparison against it —
   * `markdown !== githubBase.markdown` — so editing back to the original clears
   * dirty by itself, with no separate flag to drift. Absent for non-sourced
   * documents.
   */
  githubBase?: { markdown: string; sha: string | null }
}

/**
 * Resolve a handed-over document against the documents already open.
 *
 * A document that came from a named source (today: a GitHub file) carries a
 * `sourceId`; if one is already open, that is the document to *focus* — the same
 * source must never fork into two documents. Returns the id to focus, or null
 * when the caller should create a new document. Pure, so the rule is testable
 * without a browser and cannot drift from the caller.
 */
export function resolveSourcedDocumentId(
  jobs: readonly Pick<Job, 'id' | 'sourceId'>[],
  sourceId: string | undefined,
): string | null {
  if (!sourceId) return null
  return jobs.find((job) => job.sourceId === sourceId)?.id ?? null
}

export interface HistoryEntry {
  id: string
  name: string
  markdown: string
  ts: number
  words: number
  confidence: number
}

export interface Toast {
  id: string
  kind: 'success' | 'error' | 'info'
  msg: string
}

export type MrMarkdownExportFormat = 'md' | 'pdf' | 'html' | 'json' | 'docx' | 'chunks'

export interface ExportAssetRecord {
  filename: string
  mime_type: string
  data_url: string
  alt: string
}

export const createStructuredExport = ({
  source,
  pages,
  confidence,
  stats,
  markdown,
  html,
  assets = [],
  warnings = [],
}: {
  source: string
  pages?: number
  confidence: number
  stats: Job['stats']
  markdown: string
  html: string
  assets?: ExportAssetRecord[]
  warnings?: string[]
}) => ({
  schema: 'mr-markdown.export/v2',
  exported_at: new Date().toISOString(),
  source: {
    filename: source,
    pages: pages ?? null,
  },
  document: {
    markdown,
    rendered_html: html,
    assets,
    warnings,
  },
  quality: {
    confidence,
    stats,
  },
})

export const genId = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))

export const humanBytes = (b: number): string => {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(2)} MB`
}

export const timeAgo = (ts: number): string => {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export const countWords = (s: string): number =>
  s.trim() ? s.trim().split(/\s+/).length : 0

export const estTokens = (s: string): number =>
  Math.ceil(s.length / 4)

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/* ── Broken-image placeholder (preview-only, never touches rendered/exported HTML) ──
   Markdown sample images (image.png, thumbnail.png…) usually do not exist, and the
   browser's default broken-image glyph looks unprofessional. Preview wiring swaps a
   failed <img> for this styled placeholder card — icon + alt + source. The markup is
   fully escaped, so hostile alt/src values can never inject HTML. */
const BROKEN_IMAGE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>'

export const createBrokenImagePlaceholder = (alt: string, src: string): string => {
  const label = alt.trim() || 'Untitled image'
  const source = src.trim() || '(no source)'
  return [
    `<div class="pm-broken-img" role="img" aria-label="${escapeHtml(label)} (image unavailable)">`,
    `<span class="pm-broken-img-icon">${BROKEN_IMAGE_ICON}</span>`,
    `<span class="pm-broken-img-alt">${escapeHtml(label)}</span>`,
    `<span class="pm-broken-img-src" title="${escapeHtml(source)}">${escapeHtml(source)}</span>`,
    `</div>`,
  ].join('')
}


export const validatePageRange = (r: string): boolean => {
  if (!r.trim()) return true
  return /^(\d+(-\d+)?)(,\s*\d+(-\d+)?)*$/.test(r.trim())
}

/* ── Stats extraction (kept aligned with backend heuristics) ─── */
export const computeStats = (md: string): Job['stats'] => {
  const headings   = (md.match(/^#{1,6}\s+/gm) || []).length
  const lists      = (md.match(/^\s*[-*+]\s+/gm) || []).length + (md.match(/^\s*\d+\.\s+/gm) || []).length
  const codeBlocks = (md.match(/```/g) || []).length / 2 | 0
  const tables     = (md.match(/^\|.*\|$/gm) || []).length ? 1 : 0
  const links      = (md.match(/\[[^\]]+\]\([^)]+\)/g) || []).length
  const words      = countWords(md)
  const tokens     = estTokens(md)
  return { headings, lists, codeBlocks, tables, links, words, tokens }
}

/* ── Heuristic text signal when the API doesn't send one ─────── */
/**
 * Estimates a text-structure signal from the Markdown content — garbled
 * characters, OCR noise, boilerplate and fragmentation all reduce the score;
 * coherent structure and volume raise it. Runs purely on the converted text,
 * without comparing the original. It is not a probability or measured accuracy.
 */
export const computeConfidence = (md: string, stats: Job['stats']): number => {
  if (!md.trim()) return 0
  const stripped = md.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')
  let score = 70

  // Content volume — tiny extractions are rarely reliable
  if (stats.words > 1200) score += 10
  else if (stats.words > 400) score += 7
  else if (stats.words > 80) score += 4
  else score -= 6

  // Structure signals — real documents usually carry some
  if (stats.headings > 0) score += Math.min(8, stats.headings * 2)
  if (stats.lists > 0) score += Math.min(5, Math.ceil(stats.lists / 4))
  if (stats.tables > 0) score += 4
  if (stats.codeBlocks > 0) score += 3

  // Mojibake / replacement chars — classic sign of a bad decode or bad OCR
  const garbled = (stripped.match(/\uFFFD|Ã[Â¢£¤¥¦§¨©]|â€[\w€"œ]/g) || []).length
  if (stats.words > 0) score -= Math.min(22, Math.round((garbled / Math.max(1, stats.words)) * 400))

  // Page-number / running-header boilerplate left behind
  const boilerplate = (md.match(/^\s*(page\s+\d+\s*(of|\/)\s*\d*|\d+\s*\/\s*\d+)\s*$/gim) || []).length
  if (boilerplate > 3) score -= 6

  // Dehyphenation left overs — "docu-\nment" means line wrapping survived
  const brokenHyphens = (stripped.match(/[A-Za-z]-\n[A-Za-z]/g) || []).length
  if (brokenHyphens > 2) score -= 4

  // Line fragmentation — many near-empty lines suggests a broken layout
  const bodyLines = stripped.split('\n').filter((l) => l.trim() && !/^#{1,6}\s/.test(l) && !/^\s*[-*+]\s/.test(l))
  const fragments = bodyLines.filter((l) => l.trim().length <= 2).length
  if (bodyLines.length > 20) score -= Math.min(8, Math.round((fragments / bodyLines.length) * 40))

  // Empty headings — extracted structure that carries no text
  if (md.match(/^#{1,6}\s*$/gm)) score -= 5

  // Unreadable runs of punctuation — OCR noise
  if (stripped.match(/(\W)\1{6,}/)) score -= 3

  return Math.max(5, Math.min(100, Math.round(score)))
}

/* ── Document health: real structural analysis of the Markdown ── */
export interface HealthIssue {
  severity: 'high' | 'medium' | 'low'
  label: string
  detail: string
}

export interface DocumentHealth {
  score: number
  tone: 'Excellent' | 'Good' | 'Fair' | 'Needs work'
  summary: string
  issues: HealthIssue[]
  strengths: string[]
}

/**
 * Independent, live structural health check on the current Markdown.
 * Unlike confidence (extraction quality), this reacts to every edit the
 * user makes: heading hierarchy, empty headings, broken links, unclosed
 * code fences, inconsistent tables and general editorial readiness.
 */
export const computeDocumentHealth = (md: string, stats: Job['stats']): DocumentHealth => {
  const issues: HealthIssue[] = []
  const strengths: string[] = []

  if (!md.trim()) {
    return { score: 0, tone: 'Needs work', summary: 'The document is empty — start by writing or converting content.', issues, strengths }
  }

  let score = 100

  // Heading coverage — long unstructured walls of text hurt navigation
  const headingMatches = md.match(/^#{1,6}\s+/gm) || []
  const headingLevels = (md.match(/^#{1,6}\s/gm) || []).map((h) => h.trim().length)
  if (stats.words > 150 && headingMatches.length === 0) {
    score -= 18
    issues.push({ severity: 'high', label: 'No heading structure', detail: 'Add headings so readers can navigate and AI tools can section the document.' })
  } else if (headingMatches.length > 0) {
    strengths.push(`${headingMatches.length} heading${headingMatches.length === 1 ? '' : 's'} provide document navigation.`)
  }

  // Heading hierarchy jumps (H1 → H3 without an H2)
  let levelJumps = 0
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] - headingLevels[i - 1] > 1) levelJumps++
  }
  if (levelJumps > 0) {
    score -= Math.min(8, levelJumps * 4)
    issues.push({ severity: 'medium', label: 'Heading hierarchy skips', detail: `${levelJumps} heading level${levelJumps === 1 ? '' : 's'} jump straight down — insert intermediate headings for a clean outline.` })
  }

  // Empty headings
  const emptyHeadings = (md.match(/^#{1,6}\s*$/gm) || []).length
  if (emptyHeadings > 0) {
    score -= Math.min(6, emptyHeadings * 3)
    issues.push({ severity: 'medium', label: 'Empty headings', detail: `${emptyHeadings} heading${emptyHeadings === 1 ? '' : 's'} contain no text — give them a title or remove them.` })
  }

  // Broken links — empty href or empty label
  const brokenLinks = (md.match(/\[[^\]]+\]\(\s*\)/g) || []).length + (md.match(/\[\s*\]\([^)]+\)/g) || []).length
  if (brokenLinks > 0) {
    score -= Math.min(9, brokenLinks * 3)
    issues.push({ severity: 'medium', label: 'Broken links', detail: `${brokenLinks} link${brokenLinks === 1 ? '' : 's'} miss a URL or label — complete them before sharing.` })
  } else if (stats.links > 0) {
    strengths.push(`${stats.links} inline link${stats.links === 1 ? '' : 's'} with labels and targets; destinations are not checked.`)
  }

  // Unclosed code fences
  const fenceCount = (md.match(/```/g) || []).length
  if (fenceCount % 2 !== 0) {
    score -= 10
    issues.push({ severity: 'high', label: 'Unclosed code block', detail: 'A ``` fence was opened but never closed — everything after it renders as code.' })
  } else if (stats.codeBlocks > 0) {
    strengths.push(`${stats.codeBlocks} code block${stats.codeBlocks === 1 ? '' : 's'} are properly fenced.`)
  }

  // Table row consistency — cell counts must match inside each table
  const tableBlocks: string[][] = []
  let currentTable: string[] = []
  for (const line of md.split('\n')) {
    if (/^\s*\|.*\|\s*$/.test(line)) currentTable.push(line)
    else if (currentTable.length) { tableBlocks.push(currentTable); currentTable = [] }
  }
  if (currentTable.length) tableBlocks.push(currentTable)
  const raggedTables = tableBlocks.filter((rows) => {
    const cleaned = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r))
    if (cleaned.length < 2) return false
    const cells = cleaned.map((r) => r.split('|').length)
    return new Set(cells).size > 1
  })
  if (raggedTables.length > 0) {
    score -= 6
    issues.push({ severity: 'medium', label: 'Inconsistent tables', detail: `${raggedTables.length} table${raggedTables.length === 1 ? '' : 's'} have rows with mismatched column counts — align the pipes.` })
  } else if (stats.tables > 0) {
    strengths.push('Detected table rows have consistent column counts; cell content is not checked.')
  }

  // Layout noise — long runs of blank lines
  if (md.match(/\n{4,}/)) {
    score -= 3
    issues.push({ severity: 'low', label: 'Excess blank lines', detail: 'Several consecutive blank lines were found — collapse them for cleaner Markdown.' })
  }

  // Content length context
  if (stats.words >= 300) strengths.push(`${stats.words.toLocaleString()} words of substantive content.`)

  score = Math.max(0, Math.min(100, Math.round(score)))
  const tone: DocumentHealth['tone'] = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Fair' : 'Needs work'
  const summary = issues.length === 0
    ? 'No issues found by these structural checks. Review the content against the original before sharing.'
    : `${issues.length} structural issue${issues.length === 1 ? '' : 's'} found. These checks do not verify the content against the original.`
  return { score, tone, summary, issues, strengths }
}

/* ═══════════════════════════════════════════════════════════════
   Custom GFM → HTML renderer
   (feature-parity with previous inline renderer:
    headings, bold, italic, code, links, callouts, task lists,
    tables, blockquotes, hr, images, footnotes-lite, emoji shortcodes)
   ═══════════════════════════════════════════════════════════════ */

const EMOJI: Record<string, string> = {
  smile: '😊', heart: '❤️', fire: '🔥', star: '⭐', check: '✅', x: '❌',
  warning: '⚠️', bulb: '💡', rocket: '🚀', book: '📚', pencil: '✏️',
  eyes: '👀', tada: '🎉', thumbsup: '👍', thumbsdown: '👎', wave: '👋',
  sparkles: '✨', clap: '👏', pray: '🙏', muscle: '💪', ok_hand: '👌',
  raised_hands: '🙌', point_right: '👉', point_left: '👈', point_up: '☝️',
  clock: '🕐', calendar: '📅', mail: '📧', phone: '📱', laptop: '💻',
  package: '📦', lock: '🔒', unlock: '🔓', key: '🔑', gear: '⚙️',
  info: 'ℹ️', question: '❓', exclamation: '❗', bug: '🐛', zap: '⚡',
  cloud: '☁️', sun: '☀️', moon: '🌙', umbrella: '☂️', earth: '🌍',
}

const renderInline = (text: string, defs: ReadonlyMap<string, string> = new Map()): string => {
  // Backslash-escaped punctuation is captured up front and restored verbatim at
  // the end, so `\*` can never feed the emphasis rules (placeholder uses the
  // \u0000 sentinel that never survives into user-visible markup).
  const escapes: string[] = []
  let t = text.replace(/\\([\\`*_{}\[\]()#+\-.!|>~$])/g, (_m, ch: string) => {
    escapes.push(ch)
    return `\u0000E${escapes.length - 1}\u0000`
  })
  t = escapeHtml(t)
  // code
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
  // bold
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  // italic
  t = t.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
  t = t.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>')
  // strikethrough
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  // inline spoilers (Discord/GitHub style)
  t = t.replace(/\|\|([^|]+)\|\|/g, '<span class="pm-spoiler">$1</span>')
  // Images must be handled before links: image syntax contains a link-shaped
  // substring and otherwise becomes a leading "!" plus an anchor.
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]+)&quot;)?\)/g, (_match, alt: string, src: string, title?: string) => (
    `<img alt="${alt}" src="${src}"${title ? ` title="${title}"` : ''}/>`
  ))
  // links (optionally with a quoted title — `"…"` arrives entity-escaped as
  // `&quot;…&quot;` since escaping happens before this pass)
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]+)&quot;)?\)/g, (_m, label: string, href: string, title?: string) => (
    `<a href="${href}"${title ? ` title="${title}"` : ''} target="_blank" rel="noopener noreferrer">${label}</a>`
  ))
  // reference-style links: [label][ref] resolved against the document's
  // link definitions (collected by renderMarkdownToHtml). Unresolved stays literal.
  t = t.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (match, label: string, ref: string) => {
    const href = defs.get((ref || label).toLowerCase())
    return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>` : match
  })
  // autolinks: <https://…> and <user@example.com> (text is pre-escaped)
  t = t.replace(/&lt;((?:https?:\/\/|mailto:)[^\s]+?|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})&gt;/g, (_m, url: string) => {
    const href = /^https?:\/\//.test(url) || url.startsWith('mailto:') ? url : `mailto:${url}`
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`
  })
  // Safe whitelisted inline HTML (attribute-free or with a safe attribute set).
  // Everything else stays escaped — arbitrary HTML can never execute. Closing
  // tags are only unescaped when a whitelisted opening tag preceded them.
  let openTags = 0
  t = t.replace(/&lt;(\/?)(div|span)( align=&quot;(left|center|right|justify)&quot;)?&gt;/g, (match, slash: string, tag: string, attr?: string) => {
    if (slash) return openTags > 0 ? (openTags--, `</${tag}>`) : match
    if (attr) { openTags++; return `<${tag} align="${attr.replace(/&quot;/g, '')}">` }
    return match
  })
  t = t
    .replace(/&lt;(\/?)(mark|kbd|sub|sup|details|summary)&gt;/g, '<$1$2>')
    .replace(/&lt;img\s+((?:[^&<>]|&quot;)*?)\/?&gt;/g, (match, attrs: string) => {
      // `&quot;` is the only entity admitted in attrs (escapeHtml turns `"` into
      // it); validated on the entity form, then re-emitted with real quotes the
      // same way the div/span align attribute above is.
      if (!/^[\w\s"=.:/%&#;-]*$/.test(attrs) || /javascript:/i.test(attrs)) return match
      return `<img ${attrs.replace(/&quot;/g, '"')}/>`
    })
  // emoji shortcodes
  t = t.replace(/:([a-z_]+):/g, (m, k) => EMOJI[k] || m)
  // restore backslash-escaped punctuation verbatim (>` is entity-escaped since
  // it is reinserted after HTML escaping)
  return t.replace(/\u0000E(\d+)\u0000/g, (_m, i: string) => (escapes[Number(i)] === '>' ? '&gt;' : escapes[Number(i)]))
}

const renderCodeBlock = (code: string, lang: string): string => {
  const safeLang = escapeHtml(lang.trim())
  const lower = safeLang.toLowerCase()
  const hlName = HL_ALIASES[lower] ?? lower
  let body = escapeHtml(code)
  // highlight.js returns pre-escaped HTML with hljs-* spans; fall back to the
  // plain escaped code on any failure so content is never lost.
  if (safeLang && HLJS.getLanguage(hlName)) {
    try {
      let value = wrapOperators(HLJS.highlight(code, { language: hlName, ignoreIllegals: true }).value)
      if (hlName === 'sql') value = patchSqlKeywords(value)
      body = value
    } catch {
      body = escapeHtml(code)
    }
  }
  const className = safeLang ? ` class="language-${safeLang} lang-${safeLang}"` : ''
  // A data-lang label lets the preview show which language the block uses.
  const preAttrs = safeLang ? ` class="hl-code" data-lang="${safeLang}"` : ''
  return `<pre${preAttrs}><code${className}>${body}</code></pre>`
}

/* ── YAML frontmatter properties card (Obsidian-style) ──
   A `--- … ---` block at the very top of a document is metadata, not body
   content. Rendering it as a styled properties card keeps the preview honest:
   the metadata stays visible and structured instead of leaking as literal text
   between two stray <hr> lines. Array values render as chips. Fully escaped. */
const renderFrontmatterCard = (rows: Array<{ key: string; value: string }>): string => {
  const cells = rows.map(({ key, value }) => {
    const list = value.match(/^\[(.*)\]$/)
    const chips = list
      ? list[1].split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
      : null
    const valueHtml = chips && chips.length
      ? chips.map((chip) => `<span class="pm-fm-chip">${escapeHtml(chip)}</span>`).join('')
      : escapeHtml(value)
    return `<div class="pm-fm-row"><span class="pm-fm-key">${escapeHtml(key)}</span><span class="pm-fm-value">${valueHtml}</span></div>`
  })
  return `<div class="pm-frontmatter" role="group" aria-label="Document metadata">${cells.join('')}</div>`
}

/** Extract leading YAML frontmatter rows; null when the document has none. */
const extractFrontmatter = (lines: string[]): { rows: Array<{ key: string; value: string }>; end: number } | null => {
  if (lines[0]?.trim() !== '---') return null
  let close = -1
  // YAML frontmatter is a tight block: a blank line before the closer means
  // this is body content (e.g. an opening <hr>), not metadata.
  for (let j = 1; j < Math.min(lines.length, 100); j++) {
    if (!lines[j].trim()) return null
    if (lines[j].trim() === '---') { close = j; break }
  }
  if (close < 2) return null
  const rows: Array<{ key: string; value: string }> = []
  for (const l of lines.slice(1, close)) {
    const kv = l.match(/^ {0,3}([A-Za-z0-9_-]+)\s*:\s*(.+)$/)
    if (kv) rows.push({ key: kv[1], value: kv[2].trim().replace(/^["']|["']$/g, '') })
  }
  return rows.length ? { rows, end: close + 1 } : null
}

export const renderMarkdownToHtml = (src: string): string => {
  if (!src.trim()) return ''
  // Math ($...$, $$...$$, \(...\), \[...\]) is tokenized before Markdown
  // processing so $, *, _ and backslashes inside formulas never collide with
  // Markdown syntax (same protection contract as fenced code blocks).
  const { text, tokens } = extractMath(src)
  // Fence-aware pre-processing: HTML comments are invisible (GitHub-style) and
  // [ref]: url link definitions are collected for reference-style links.
  const lines: string[] = []
  const linkDefs = new Map<string, string>()
  let preFence = false
  let pending = ''
  const flushPending = () => {
    if (!pending) return
    const cleaned = pending.replace(/<!--[\s\S]*?-->/g, '').replace(/\n$/, '')
    for (const l of cleaned.split('\n')) {
      const def = l.match(/^ {0,3}\[([^\]^]+)\]:\s*(?:<([^>]+)>|(\S+))(?:\s+"[^"]*")?\s*$/)
      if (def) linkDefs.set(def[1].trim().toLowerCase(), def[2] ?? def[3])
      else lines.push(l)
    }
    pending = ''
  }
  for (const raw of text.split('\n')) {
    if (/^```/.test(raw)) { flushPending(); preFence = !preFence; lines.push(raw); continue }
    if (preFence) { lines.push(raw); continue }
    pending += raw + '\n'
    // Buffer while an HTML comment is open so it can disappear whole.
    if (pending.includes('<!--') && !pending.includes('-->')) continue
    flushPending()
  }
  flushPending()
  const out: string[] = []
  // Leading YAML frontmatter becomes a properties card, never body content.
  let firstBodyLine = 0
  const frontmatter = extractFrontmatter(lines)
  if (frontmatter) {
    out.push(renderFrontmatterCard(frontmatter.rows))
    firstBodyLine = frontmatter.end
  }
  let inCode = false
  let codeBuf: string[] = []
  let codeLang = ''
  const listStack: Array<{ tag: 'ul' | 'ol'; indent: number; liOpen: boolean }> = []
  let inTable = false
  let tableRows: string[][] = []
  let paragraph: string[] = []
  let inDl = false
  const usedAnchors = new Map<string, number>()

  const headingAnchor = (title: string, explicit?: string): string => {
    const base = explicit || title.toLowerCase().replace(/[^\w]+/g, '-')
    const count = usedAnchors.get(base) || 0
    usedAnchors.set(base, count + 1)
    return count ? `${base}-${count + 1}` : base
  }

  const flushParagraph = () => {
    if (paragraph.length) {
      // GitHub/Obsidian-style "breaks" mode: every line break inside a
      // paragraph renders visibly (<br/>), so what the user writes line-by-line
      // is what the preview shows. A blank line still starts a new paragraph,
      // and the classic hard-break forms (two trailing spaces, trailing
      // backslash) keep working — they simply produce the same visible break.
      const parts = paragraph.map((l) => renderInline(l.replace(/[ \t]+$/, '').replace(/\\$/, ''), linkDefs))
      out.push(`<p>${parts.join('<br/>\n')}</p>`)
      paragraph = []
    }
  }
  const flushDl = () => {
    if (inDl) { out.push('</dl>'); inDl = false }
  }
  // List frames track their indentation and whether their last <li> is still
  // open, so nested lists end up INSIDE the parent item ("<li>a<ul>…</ul></li>")
  // instead of as siblings — matching standard Markdown rendering.
  const popFrame = () => {
    const frame = listStack.pop()!
    if (frame.liOpen) out.push('</li>')
    out.push(`</${frame.tag}>`)
  }
  const closeOpenLi = () => {
    const frame = listStack[listStack.length - 1]
    if (frame?.liOpen) { out.push('</li>'); frame.liOpen = false }
  }
  const flushList = () => {
    while (listStack.length) popFrame()
  }
  // Deeper indent opens a nested list inside the current item; shallower indent
  // closes deeper frames; the same indent is a sibling item.
  const syncListFrames = (tag: 'ul' | 'ol', indent: number) => {
    while (
      listStack.length &&
      (listStack[listStack.length - 1].indent > indent ||
        (listStack[listStack.length - 1].indent === indent && listStack[listStack.length - 1].tag !== tag))
    ) {
      popFrame()
    }
    if (!listStack.length || listStack[listStack.length - 1].indent < indent) {
      out.push(`<${tag}>`)
      listStack.push({ tag, indent, liOpen: false })
    } else {
      closeOpenLi()
    }
  }
  const flushTable = () => {
    if (!tableRows.length) return
    const [header, sep, ...rows] = tableRows
    if (!sep) {
      inTable = false
      tableRows = []
      return
    }
    const aligns = sep.map(c => {
      const t = c.trim()
      if (t.startsWith(':') && t.endsWith(':')) return 'center'
      if (t.endsWith(':')) return 'right'
      return 'left'
    })
    let html = '<table><thead><tr>'
    header.forEach((h, i) => { html += `<th style="text-align:${aligns[i] || 'left'}">${renderInline(h.trim(), linkDefs)}</th>` })
    html += '</tr></thead><tbody>'
    rows.forEach(r => {
      html += '<tr>'
      r.forEach((c, i) => { html += `<td style="text-align:${aligns[i] || 'left'}">${renderInline(c.trim(), linkDefs)}</td>` })
      html += '</tr>'
    })
    html += '</tbody></table>'
    out.push(html)
    inTable = false
    tableRows = []
  }

  for (let i = firstBodyLine; i < lines.length; i++) {
    const line = lines[i]

    // fenced code
    const fence = line.match(/^```(\S*)/)
    if (fence) {
      if (inCode) {
        out.push(renderCodeBlock(codeBuf.join('\n'), codeLang))
        codeBuf = []
        codeLang = ''
        inCode = false
      } else {
        flushParagraph(); flushList(); flushTable(); flushDl()
        inCode = true
        codeLang = fence[1] || ''
      }
      continue
    }
    if (inCode) { codeBuf.push(line); continue }

    // table (a leading "||" is an inline spoiler, not a table row)
    if (/^\s*\|.*\|\s*$/.test(line) && !/^\s*\|\|/.test(line)) {
      flushParagraph(); flushList(); flushDl()
      inTable = true
      const cells = line.trim().slice(1, -1).split('|')
      tableRows.push(cells)
      continue
    } else if (inTable) {
      flushTable()
    }

    // empty
    if (!line.trim()) { flushParagraph(); flushList(); continue }

    // heading
    const h = line.match(/^(#{1,6})\s+(.+?)(?:\s+\{#([^}]+)\})?\s*$/)
    if (h) {
      flushParagraph(); flushList(); flushDl()
      const level = h[1].length
      const anchor = headingAnchor(h[2], h[3])
      out.push(`<h${level} id="${escapeHtml(anchor)}">${renderInline(h[2], linkDefs)}</h${level}>`)
      continue
    }

    // setext headings (alternative underline style): a === line under a
    // paragraph makes it H1, a --- line makes it H2. Only applies when the
    // preceding lines formed a paragraph; a bare --- still renders as <hr>.
    const setext = line.match(/^(=+|-+)\s*$/)
    if (setext && paragraph.length) {
      const level = setext[1][0] === '=' ? 1 : 2
      const title = paragraph.join(' ')
      paragraph = []
      const anchor = headingAnchor(title)
      out.push(`<h${level} id="${escapeHtml(anchor)}">${renderInline(title)}</h${level}>`)
      continue
    }

    // hr
    if (/^(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
      flushParagraph(); flushList(); flushDl()
      out.push('<hr/>')
      continue
    }

    // special containers :::note … ::: (rendered as color-coded callout boxes)
    const container = line.match(/^:::(\w+)\s*(.*)$/)
    if (container) {
      flushParagraph(); flushList(); flushTable(); flushDl()
      const kind = container[1].toLowerCase()
      const body: string[] = []
      i++
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) { body.push(lines[i]); i++ }
      const head = container[2]
        ? `<div class="pm-container-head">${escapeHtml(container[2])}</div>`
        : `<div class="pm-container-head">${escapeHtml(kind.toUpperCase())}</div>`
      out.push(`<div class="pm-container pm-container-${kind}">${head}${renderMarkdownToHtml(body.join('\n'))}</div>`)
      continue
    }
    if (/^:::\s*$/.test(line)) { flushDl(); continue }

    // Block-level whitelisted HTML: <div> / <div align="…"> … </div>. GitHub-style
    // section wrappers — the inner markdown keeps rendering, so centered sections
    // compose with headings, lists and everything else. Nested divs are tracked by
    // depth. A stray </div> with no opener is dropped, exactly like browsers
    // ignore unmatched close tags — it must never surface as literal "</div>" text.
    if (/^ {0,3}<div(?:\s+align="(?:left|center|right|justify)")?>\s*$/.test(line)) {
      flushParagraph(); flushList(); flushTable(); flushDl()
      const align = line.match(/align="([^"]*)"/)
      const body: string[] = []
      let depth = 1
      i++
      while (i < lines.length && depth > 0) {
        const inner = lines[i]
        if (/^ {0,3}<div(?:\s+align="(?:left|center|right|justify)")?>\s*$/.test(inner)) depth++
        else if (/^ {0,3}<\/div>\s*$/.test(inner)) { depth--; if (!depth) break }
        body.push(inner)
        i++
      }
      out.push(`<div${align ? ` align="${align[1]}"` : ''}>${renderMarkdownToHtml(body.join('\n'))}</div>`)
      continue
    }
    if (/^ {0,3}<\/div>\s*$/.test(line)) {
      // stray closing tag with no opener in this document — same as a browser.
      flushParagraph(); flushList(); flushDl()
      continue
    }

    // blockquote / callout
    const bq = line.match(/^>\s?(.*)$/)
    if (bq) {
      flushParagraph(); flushList(); flushDl()
      const inner = bq[1]
      const callout = inner.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i)
      if (callout) {
        const kind = callout[1].toLowerCase()
        const body: string[] = [callout[2]]
        while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1])) {
          body.push(lines[++i].replace(/^>\s?/, ''))
        }
        out.push(`<div class="pm-callout pm-callout-${kind}"><div class="pm-callout-head">${kind.toUpperCase()}</div>${renderInline(body.filter(Boolean).join(' '), linkDefs)}</div>`)
      } else {
        const body: string[] = [inner]
        while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1])) {
          body.push(lines[++i].replace(/^>\s?/, ''))
        }
        const stripped = body.map((l) => l.replace(/^>\s?/, ''))
        // body lines have exactly one "›" level removed; if a marker remains,
        // the quote is nested and rendered recursively so depth is preserved.
        if (body.some((l) => /^\s*>/.test(l))) {
          out.push(`<blockquote>${renderMarkdownToHtml(body.join('\n'))}</blockquote>`)
        } else {
          out.push(`<blockquote>${renderInline(stripped.filter(Boolean).join(' '), linkDefs)}</blockquote>`)
        }
      }
      continue
    }

    // definition list entry: previous paragraph becomes the term
    const dd = line.match(/^:\s+(.*)$/)
    if (dd) {
      if (paragraph.length) {
        const term = paragraph.join(' ')
        paragraph = []
        if (!inDl) { flushList(); out.push('<dl class="pm-dl">'); inDl = true }
        out.push(`<dt>${renderInline(term, linkDefs)}</dt>`)
      } else if (!inDl) {
        flushList(); flushDl()
        out.push('<dl class="pm-dl">')
        inDl = true
      }
      out.push(`<dd>${renderInline(dd[1], linkDefs)}</dd>`)
      continue
    }

    // unordered / task list
    const ul = line.match(/^(\s*)([-*+])\s+(\[[ xX]\]\s+)?(.*)$/)
    if (ul) {
      flushParagraph(); flushDl()
      syncListFrames('ul', ul[1].replace(/\t/g, '    ').length)
      closeOpenLi()
      const content = ul[4]
      if (ul[3]) {
        const checked = /\[[xX]\]/.test(ul[3])
        out.push(`<li><input type="checkbox" disabled${checked ? ' checked' : ''}/> ${renderInline(content, linkDefs)}`)
      } else {
        out.push(`<li>${renderInline(content, linkDefs)}`)
      }
      listStack[listStack.length - 1].liOpen = true
      continue
    }

    // ordered list
    const ol = line.match(/^(\s*)\d+\.\s+(.*)$/)
    if (ol) {
      flushParagraph(); flushDl()
      syncListFrames('ol', ol[1].replace(/\t/g, '    ').length)
      closeOpenLi()
      out.push(`<li>${renderInline(ol[2], linkDefs)}`)
      listStack[listStack.length - 1].liOpen = true
      continue
    }

    // paragraph accumulate
    flushList()
    paragraph.push(line)
  }
  flushParagraph(); flushList(); flushTable(); flushDl()
  if (inCode && codeBuf.length) out.push(renderCodeBlock(codeBuf.join('\n'), codeLang))
  return restoreMathTokens(out.join('\n'), tokens)
}

/* ═══════════════════════════════════════════════════════════════
   AI post-processing helpers (all local, no API needed for defaults)
   ═══════════════════════════════════════════════════════════════ */

export const generateTOC = (md: string): string => {
  const lines = md.split('\n')
  const toc: string[] = ['## Table of Contents', '']
  for (const l of lines) {
    const h = l.match(/^(#{2,4})\s+(.+?)(?:\s+\{#([^}]+)\})?\s*$/)
    if (h) {
      const level = h[1].length - 2
      const anchor = h[3] || h[2].toLowerCase().replace(/[^\w]+/g, '-')
      toc.push(`${'  '.repeat(level)}- [${h[2]}](#${anchor})`)
    }
  }
  toc.push('')
  return toc.join('\n')
}

export const cleanupMarkdown = (md: string): string => {
  // Page labels and standalone numbers may be real content. Only collapse
  // redundant blank lines; preserve fenced code and Markdown hard breaks.
  let fence = ''
  let blankLines = 0
  return md.split('\n').filter((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = ''
      blankLines = 0
      return true
    }
    if (fence || line.trim()) {
      blankLines = 0
      return true
    }
    blankLines++
    return blankLines <= 2
  }).join('\n')
}

export const injectFrontmatter = (md: string, meta: {
  title: string
  source: string
  pages?: number
  language?: string
  tokens?: number
  confidence?: number
}): string => {
  if (md.startsWith('---')) return md
  const fm = ['---']
  fm.push(`title: "${meta.title.replace(/"/g, '\\"')}"`)
  fm.push(`source: "${meta.source}"`)
  fm.push(`converted: "${new Date().toISOString().split('T')[0]}"`)
  if (meta.pages != null) fm.push(`pages: ${meta.pages}`)
  if (meta.language) fm.push(`language: "${meta.language}"`)
  if (meta.tokens != null) fm.push(`tokens_estimate: ${meta.tokens}`)
  if (meta.confidence != null) fm.push(`confidence: ${meta.confidence}`)
  fm.push('---', '')
  return fm.join('\n') + md
}

export const chunkMarkdown = (md: string, tokenLimit: number): { title: string; body: string }[] => {
  // Section-aware split by top-level headings, respecting token limit
  const lines = md.split('\n')
  const sections: { title: string; body: string[] }[] = [{ title: 'Intro', body: [] }]
  for (const l of lines) {
    const h = l.match(/^#{1,2}\s+(.+?)\s*$/)
    if (h) sections.push({ title: h[1], body: [l] })
    else sections[sections.length - 1].body.push(l)
  }
  const chunks: { title: string; body: string }[] = []
  let cur = { title: 'Part 1', body: '' }
  for (const s of sections) {
    const block = s.body.join('\n')
    if (estTokens(cur.body + block) > tokenLimit && cur.body) {
      chunks.push(cur)
      cur = { title: `Part ${chunks.length + 1} — ${s.title}`, body: block }
    } else {
      cur.body = cur.body ? cur.body + '\n' + block : block
      if (cur.title === 'Part 1' && s.title !== 'Intro') cur.title = `Part 1 — ${s.title}`
    }
  }
  if (cur.body.trim()) chunks.push(cur)
  return chunks
}

/* ═══════════════════════════════════════════════════════════════
   Export helpers
   ═══════════════════════════════════════════════════════════════ */

export const downloadBlob = (data: BlobPart, filename: string, mime: string) => {
  const blob = new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  // Browsers may start a download asynchronously. Revoking in the same task can
  // produce zero-byte downloads, especially for larger PDF and DOCX responses.
  window.setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 1_000)
}

export const stripName = (name: string): string =>
  name.replace(/\.[^.]+$/, '')

export const sanitizeExportFilename = (name: string): string => {
  const normalized = name.normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
  const compact = normalized.replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '')
  return compact.slice(0, 120) || 'document'
}

export const markdownToPlainText = (markdown: string): string => {
  // TXT has no rich-text semantics, but links, image descriptions and code must
  // remain represented rather than being silently removed.
  return markdown
    .replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g, '$1 <$2>')
    .replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g, '$1 <$2>')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '- ')
    .replace(/^\s*[-*+]\s+/gm, '- ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
}

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ')
