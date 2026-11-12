/**
 * How a line of resume text is read: **bold**, _italic_, [label](href), and
 * paragraphs vs bullet/numbered lists. One reading is shared by the page
 * (ResumePage.tsx) and the LaTeX export (MrResumeStudio.tsx), so what the
 * guest sees and what the .tex compiles never disagree about a line.
 */

export type InlinePart =
  | { kind: 'text'; text: string; start: number }
  | { kind: 'bold'; children: InlinePart[] }
  | { kind: 'italic'; children: InlinePart[] }
  | { kind: 'link'; children: InlinePart[]; href: string }

/** Only links a resume can honestly carry; anything else stays visible text. */
export function safeResumeHref(value: string) {
  const href = value.trim()
  if (/^(https?:|mailto:|tel:)/i.test(href)) return href
  if (/^www\./i.test(href)) return `https://${href}`
  return null
}

/** `offset` keeps each part's position in the whole field, so Banglish corrections stay anchored. */
export function parseInline(value: string, offset = 0): InlinePart[] {
  const parts: InlinePart[] = []
  const pattern = /\*\*([^*\n]+)\*\*|_([^_\n]+)_|\[([^\]\n]+)\]\(([^()\s]+)\)/g
  let cursor = 0
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ kind: 'text', text: value.slice(cursor, index), start: offset + cursor })
    if (match[1] !== undefined) parts.push({ kind: 'bold', children: parseInline(match[1], offset + index + 2) })
    else if (match[2] !== undefined) parts.push({ kind: 'italic', children: parseInline(match[2], offset + index + 1) })
    else {
      const href = safeResumeHref(match[4])
      parts.push(href ? { kind: 'link', children: parseInline(match[3], offset + index + 1), href } : { kind: 'text', text: match[0], start: offset + index })
    }
    cursor = index + match[0].length
  }
  if (cursor < value.length) parts.push({ kind: 'text', text: value.slice(cursor), start: offset + cursor })
  return parts
}

export function contentBlocks(value: string) {
  return value.split(/\n\s*\n/).flatMap((paragraph) => {
    const blocks: { list: 'bullet' | 'numbered' | null; lines: string[] }[] = []
    for (const line of paragraph.split('\n')) {
      const list = /^\d+\. /u.test(line) ? 'numbered' : /^[-•→*] /u.test(line) ? 'bullet' : null
      const previous = blocks[blocks.length - 1]
      if (previous?.list === list) previous.lines.push(line)
      else blocks.push({ list, lines: [line] })
    }
    return blocks
  })
}
