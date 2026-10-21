/* ── Markdown Merge — structure scanner ────────────────────────────────────
   A dependency-free, fence/setext/comment-aware scanner that turns a Markdown
   document into its frontmatter, preamble and ordered sections. It exists
   because the module has no mdast/remark (verified: not in package.json) and
   because Mr. Markdown renders through its own line-scan parser, so matching
   that shape keeps the section model honest with what the preview will show.

   It is *structure-only*: it never re-serialises a document. Concatenation is
   byte-faithful and does not use this file at all; only the section-aware merge
   consumes these sections. */

import { slugify, splitFrontmatter, type FrontmatterSplit } from './normalize.ts'

export interface MdSection {
  level: number
  title: string
  anchor: string
  /** Section text with the heading line removed and edge blank lines trimmed. */
  body: string
  startLine: number
  style: 'atx' | 'setext'
}

export interface ParsedDoc extends FrontmatterSplit {
  /** Content before the first heading (frontmatter already removed). */
  preamble: string
  sections: MdSection[]
  /** Best guess at the document's own title, for labelling the collation. */
  titleGuess: string | null
  /** Setext headings found — the section engine reports them as normalised. */
  setextCount: number
}

const ATX = /^(#{1,6})\s+(.*?)(?:\s+\{#([^}]+)\})?\s*$/
const SETEXT = /^(=+|-+)\s*$/
const HR = /^(-{3,}|_{3,}|\*{3,})\s*$/
/** A line that opens a block, so it can never be a setext heading's title. */
const BLOCKISH = /^(\s*([-*+]|\d+\.)\s+|\s*>\s?|\s*\||\s*:::|:\s)/

export function parseDocument(src: string): ParsedDoc {
  const split = splitFrontmatter(src)
  const lines = split.body.split('\n')

  const sections: MdSection[] = []
  const preambleLines: string[] = []
  let current: { level: number; title: string; style: 'atx' | 'setext'; startLine: number; body: string[] } | null = null

  let fence: string | null = null
  let inComment = false
  let setextCount = 0
  /** A plain paragraph line a setext underline may attach to, or null. */
  let pendingPara: string | null = null

  const addLine = (line: string) => {
    if (current) current.body.push(line)
    else preambleLines.push(line)
  }

  const flush = () => {
    if (!current) return
    sections.push({
      level: current.level,
      title: current.title,
      anchor: slugify(current.title),
      body: current.body.join('\n').trim(),
      startLine: current.startLine,
      style: current.style,
    })
    current = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Inside an open fence: verbatim, and a matching marker closes it. A `#`
    // or `---` in here is content, never a heading or a separator.
    if (fence) {
      addLine(line)
      if (fence === ':::' ? /^\s*:::\s*$/.test(line) : new RegExp('^\\s*' + fence).test(line)) {
        fence = null
      }
      continue
    }

    if (inComment) {
      addLine(line)
      if (line.includes('-->')) inComment = false
      continue
    }

    // Fence openers: ``` / ~~~ code blocks and :::kind containers, both opaque.
    const codeFence = line.match(/^\s*(`{3,}|~{3,})/)
    if (codeFence) {
      addLine(line)
      fence = codeFence[1][0]
      pendingPara = null
      continue
    }
    if (/^\s*:::[A-Za-z][\w-]*/.test(line)) {
      addLine(line)
      fence = ':::'
      pendingPara = null
      continue
    }

    if (line.includes('<!--')) {
      addLine(line)
      if (!line.includes('-->')) inComment = true
      pendingPara = null
      continue
    }

    if (!line.trim()) {
      addLine(line)
      pendingPara = null
      continue
    }

    // ATX heading.
    const atx = line.match(ATX)
    if (atx) {
      flush()
      current = { level: atx[1].length, title: atx[2], style: 'atx', startLine: i, body: [] }
      pendingPara = null
      continue
    }

    // Setext heading — only when a paragraph line precedes it. The title line
    // has already been buffered, so pull it back out before starting the section.
    const setext = line.match(SETEXT)
    if (setext && pendingPara) {
      if (current) {
        const last: string | undefined = current.body[current.body.length - 1]
        if (last !== undefined && last.trim() === pendingPara) current.body.pop()
      } else {
        const last: string | undefined = preambleLines[preambleLines.length - 1]
        if (last !== undefined && last.trim() === pendingPara) preambleLines.pop()
      }
      flush()
      current = {
        level: setext[1][0] === '=' ? 1 : 2,
        title: pendingPara,
        style: 'setext',
        startLine: i - 1,
        body: [],
      }
      setextCount++
      pendingPara = null
      continue
    }

    if (HR.test(line)) {
      addLine(line)
      pendingPara = null
      continue
    }

    addLine(line)
    pendingPara = BLOCKISH.test(line) ? null : line.trim()
  }

  flush()

  const titleGuess =
    sections.find((s) => s.level === 1)?.title ?? sections[0]?.title ?? null

  return {
    ...split,
    preamble: preambleLines.join('\n').trim(),
    sections,
    titleGuess,
    setextCount,
  }
}
