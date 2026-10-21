/* ── Markdown Merge — shared, dependency-free transforms ───────────────────
   Small pure helpers used by both engines. Imports only the shared *type*
   contract (not `../utils.ts`, which pulls highlight.js/katex/dompurify and
   would break the colocated node:test run). Anchor slugs mirror the renderer's
   `headingAnchor` shape so dedupe decisions match what the preview will show. */

import type { MergeOptions } from './types.ts'

/** Same shape as the renderer's `headingAnchor` base: lowercase, non-word → '-'. */
export const slugify = (value: string): string => {
  const base = value.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '')
  return base || 'section'
}

/* ── Frontmatter ─────────────────────────────────────────────────────────── */

export interface FrontmatterSplit {
  /** Raw block including both `---` fences, or null when there is none. */
  frontmatter: string | null
  /** The document with the frontmatter block removed. */
  body: string
  crlf: boolean
  hadBom: boolean
}

/**
 * Split a leading YAML frontmatter block. Only a block that opens on the very
 * first line and closes on a later bare `---` counts — a `---` further down the
 * body is a thematic break, not frontmatter, exactly as the renderer decides.
 */
export function splitFrontmatter(src: string): FrontmatterSplit {
  const hadBom = src.charCodeAt(0) === 0xfeff
  let text = hadBom ? src.slice(1) : src
  const crlf = /\r\n/.test(text)
  text = text.replace(/\r\n?/g, '\n')

  const lines = text.split('\n')
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        return {
          frontmatter: lines.slice(0, i + 1).join('\n'),
          body: lines.slice(i + 1).join('\n'),
          crlf,
          hadBom,
        }
      }
      // A non-empty line that is not a key/value rule means this is not a
      // frontmatter block after all (a horizontal rule at the top instead).
      if (lines[i].trim() && !/^[A-Za-z0-9_-]+\s*:/.test(lines[i])) break
    }
  }
  return { frontmatter: null, body: text, crlf, hadBom }
}

/** Flat `key: value` reader — enough for the merge decisions, no YAML parser. */
export function parseFrontmatter(block: string | null): Record<string, string> {
  if (!block) return {}
  const data: Record<string, string> = {}
  const inner = block.replace(/^---\n/, '').replace(/\n---\s*$/, '')
  for (const line of inner.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (m) data[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return data
}

export function renderFrontmatter(data: Record<string, string>): string {
  const keys = Object.keys(data)
  if (!keys.length) return ''
  return `---\n${keys.map((k) => `${k}: ${data[k]}`).join('\n')}\n---`
}

/**
 * Resolve the single frontmatter block a merged document carries, applying the
 * chosen policy to every source's raw block. Shared by both engines so the
 * policy can only ever mean one thing.
 */
export function resolveFrontmatterBlocks(
  blocks: (string | null)[],
  opts: MergeOptions,
): { block: string; dropped: number } {
  const count = blocks.filter(Boolean).length
  const dropped = Math.max(0, count - 1)
  switch (opts.frontmatter) {
    case 'strip':
      return { block: '', dropped: count }
    case 'merge': {
      const merged: Record<string, string> = {}
      for (const b of blocks) {
        const data = parseFrontmatter(b)
        for (const key of Object.keys(data)) if (!(key in merged)) merged[key] = data[key]
      }
      return { block: renderFrontmatter(merged), dropped }
    }
    case 'new-title': {
      const merged: Record<string, string> = {}
      const first = parseFrontmatter(blocks[0] ?? null)
      for (const key of Object.keys(first)) if (key !== 'title') merged[key] = first[key]
      return { block: renderFrontmatter({ title: opts.documentTitle, ...merged }), dropped }
    }
    case 'keep-first':
    default:
      return { block: blocks[0] ?? '', dropped }
  }
}

/* ── Footnotes ───────────────────────────────────────────────────────────── */

/** Highest numeric footnote id in the text, or 0 when there is none. */
export function footnoteMax(text: string): number {
  let max = 0
  const re = /\[\^(\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) max = Math.max(max, Number(m[1]))
  return max
}

export interface FootnoteRemap {
  text: string
  /** Distinct ids that moved. */
  count: number
}

/**
 * Add `offset` to every numeric footnote id. A single pass rewrites both the
 * reference (`[^1]`) and the definition (`[^1]:`) because the definition's
 * `[^1]` is a prefix of the same token — no separate definition branch needed.
 */
export function remapFootnotes(text: string, offset: number): FootnoteRemap {
  if (offset <= 0 || !text.includes('[^')) return { text, count: 0 }
  const seen = new Set<number>()
  const out = text.replace(/\[\^(\d+)\]/g, (_m, n: string) => {
    const id = Number(n)
    seen.add(id)
    return `[^${id + offset}]`
  })
  return { text: out, count: seen.size }
}

/* ── Relative link / image audit ─────────────────────────────────────────── */

const ABSOLUTE_TARGET = /^([a-z][a-z0-9+.-]*:|\/\/|\/|#|data:)/i

/** Count relative link/image targets — the ones a join can strand. */
export function countRelativePaths(text: string): number {
  let count = 0
  for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (!ABSOLUTE_TARGET.test(m[1])) count++
  }
  return count
}

/** Prefix relative link/image targets with `prefix` (e.g. `chapter-2/`). */
export function rewriteRelativePaths(text: string, prefix: string): { text: string; count: number } {
  let count = 0
  const out = text.replace(/\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (whole, target: string, title?: string) => {
    if (ABSOLUTE_TARGET.test(target) || target.startsWith(prefix)) return whole
    count++
    return `](${prefix}${target}${title ?? ''})`
  })
  return { text: out, count }
}

/* ── Fence integrity ─────────────────────────────────────────────────────── */

/**
 * True when a source has an odd number of ``` openers, i.e. an unclosed block.
 * A naive join can then swallow the following source; the engine warns rather
 * than silently producing a broken document (truth-telling).
 */
export function hasFenceImbalance(markdown: string): boolean {
  let ticks = 0
  for (const line of markdown.split(/\r?\n/)) if (/^```/.test(line)) ticks++
  return ticks % 2 === 1
}

/* ── Small text utilities ────────────────────────────────────────────────── */

export const countWords = (value: string): number =>
  value.trim() ? value.trim().split(/\s+/).length : 0

/** Strip leading/trailing newlines only — the seam, never the inner bytes. */
export const trimSeam = (value: string): string => value.replace(/^\n+/, '').replace(/\n+$/, '')
