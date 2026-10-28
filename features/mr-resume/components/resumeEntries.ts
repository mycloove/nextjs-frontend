// Entry & contact conventions shared by the Visual canvas and the LaTeX source.
// Data-adjacent rules only: these helpers decide how a written line is shaped,
// never what it means. Kept JSX-free so node:test can strip-run it directly.

/** The inline link syntax the paper already supports: [label](href). */
export const inlineLinkPattern = /\[([^\]\n]+)\]\(([^()\s]+)\)/u

export type ContactIconId = 'email' | 'phone' | 'linkedin' | 'github' | 'globe'

/** One link-shape per well-known scheme; every other address is a globe. */
export function contactIconFor(href: string): ContactIconId {
  const address = href.trim().toLowerCase()
  if (address.startsWith('mailto:')) return 'email'
  if (address.startsWith('tel:')) return 'phone'
  if (/(?:^|\.|\/\/)linkedin\./u.test(address)) return 'linkedin'
  if (/(?:^|\.|\/\/)github\./u.test(address)) return 'github'
  return 'globe'
}

export type ContactLine = { icon: ContactIconId | null; rest: string }

/**
 * The profile header prefixes any line carrying a contact link with a small
 * scheme-matched glyph; untouched lines keep writing exactly as typed.
 */
export function parseContactLine(line: string): ContactLine {
  const match = line.match(inlineLinkPattern)
  return match ? { icon: contactIconFor(match[2]), rest: line } : { icon: null, rest: line }
}

export type EntryLine = { lead: string; leadOffset: number; meta: string; metaOffset: number }

/**
 * The pipe convention behind this template's entries:
 *
 *   left side | right side
 *
 * Exactly one unescaped ` | `; the right side is set as the italic date/link
 * metadata aligned to the far edge. A single-part line is not an entry, and a
 * literal pipe can always be written escaped as `\|`. List items keep their
 * separators as plain text (only paragraph lines shape as entries).
 */
export function parseEntryLine(line: string): EntryLine | null {
  if (/^(?:\d+\. |[-•→*] )/u.test(line)) return null
  let cursor = 0
  let separator = -1
  while (cursor < line.length) {
    const space = line.indexOf(' | ', cursor)
    if (space === -1) break
    if (line[space - 1] === '\\') { cursor = space + 1; continue }
    if (separator !== -1) return null
    separator = space
    cursor = space + 3
  }
  if (separator === -1) return null
  const lead = line.slice(0, separator).trim()
  const meta = line.slice(separator + 3).trim()
  if (!lead || !meta) return null
  return { lead, leadOffset: line.indexOf(lead), meta, metaOffset: line.lastIndexOf(meta) }
}

/** The paragraph line feeds the canvas through the same inline parser, so the
 *  lead keeps its bold/italic/link shapes. Meta reads as italic markup in CSS
 *  and as \textit in LaTeX, and any link inside it earns the template's
 *  external-link mark after the whole metadata side. */
export function entryHasLink(meta: string): boolean {
  return inlineLinkPattern.test(meta)
}
