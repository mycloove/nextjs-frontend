/* ═════════════════════════════════════════════════════════════════════════
   Editor helper utilities — pure, dependency-free
   ──────────────────────────────────────────────────────────────────────────
   Kept separate from views/utils so the workspace file stays lean.

   Contents:
     • caretCoordinates      — pixel position of textarea caret (for popovers)
     • buildFindRegex         — compiles user options into a RegExp
     • findAllMatches         — returns [start, end] tuples for highlighting
     • htmlToMarkdown         — small, safe HTML → GFM converter for paste
     • isProbablyUrl          — quick URL sniff for smart-paste
   ═════════════════════════════════════════════════════════════════════════ */

/* ── Mirror-div technique for caret pixel coordinates ──────────────── */

const MIRROR_STYLE_PROPS: string[] = [
  'boxSizing',
  'width',
  'height',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'MozTabSize',
  'whiteSpace',
  'wordWrap',
]


export interface CaretCoords {
  /** Pixel offset from textarea top-left (before scroll). */
  top: number
  left: number
  /** Approximate line height at the caret. */
  height: number
}

/**
 * Returns the pixel position (relative to the textarea) of the caret at
 * `position`. Uses a hidden mirror div that copies the textarea's typography.
 * Ref: https://github.com/component/textarea-caret-position (MIT)
 */
export function caretCoordinates(
  el: HTMLTextAreaElement,
  position: number,
): CaretCoords {
  const doc = document
  const div = doc.createElement('div')
  div.id = 'pm-caret-mirror'

  const style = div.style
  const computed = window.getComputedStyle(el)

  style.whiteSpace = 'pre-wrap'
  style.wordWrap = 'break-word'
  style.position = 'absolute'
  style.visibility = 'hidden'
  style.top = '0'
  style.left = '-9999px'
  style.overflow = 'hidden'

  for (const prop of MIRROR_STYLE_PROPS) {
    ;(style as unknown as Record<string, string>)[prop as string] =
      (computed as unknown as Record<string, string>)[prop as string]
  }

  const value = el.value.substring(0, position)
  div.textContent = value.replace(/\n$/, '\n\u200B')

  const span = doc.createElement('span')
  span.textContent = el.value.substring(position) || '.'
  div.appendChild(span)

  doc.body.appendChild(div)
  const rect = span.getBoundingClientRect()
  const parentRect = div.getBoundingClientRect()
  const top = rect.top - parentRect.top
  const left = rect.left - parentRect.left
  const height = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) || 20
  doc.body.removeChild(div)

  return { top, left, height }
}

/* ══════════════════════════════════════════════════════════════════════
   FIND & REPLACE helpers
   ══════════════════════════════════════════════════════════════════════ */

export interface FindOptions {
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
}

/** Compile the find query into a RegExp. Returns null on invalid regex. */
export function buildFindRegex(query: string, opts: FindOptions): RegExp | null {
  if (!query) return null
  try {
    let source = opts.regex ? query : escapeRegex(query)
    if (opts.wholeWord) source = `\\b(?:${source})\\b`
    const flags = 'g' + (opts.caseSensitive ? '' : 'i')
    return new RegExp(source, flags)
  } catch {
    return null
  }
}

const escapeRegex = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface Match {
  start: number
  end: number
}

/** Return every non-overlapping match in `text`. */
export function findAllMatches(text: string, re: RegExp | null): Match[] {
  if (!re || !text) return []
  const out: Match[] = []
  let m: RegExpExecArray | null
  let guard = 0
  re.lastIndex = 0
  while ((m = re.exec(text)) && guard++ < 10000) {
    // Prevent zero-width infinite loops
    if (m.index === re.lastIndex) re.lastIndex++
    else out.push({ start: m.index, end: m.index + m[0].length })
  }
  return out
}

/* ══════════════════════════════════════════════════════════════════════
   SMART PASTE — HTML → Markdown (lightweight)
   ══════════════════════════════════════════════════════════════════════ */

const URL_RE = /^https?:\/\/[^\s<>]+$/i

export const isProbablyUrl = (s: string): boolean =>
  URL_RE.test(s.trim())

/**
 * Minimal HTML → GFM Markdown converter. Handles the common formatting
 * users paste from web pages: paragraphs, headings, bold/italic/code,
 * lists, links, images, blockquotes, tables, and horizontal rules.
 *
 * We intentionally avoid pulling in `turndown` to keep bundle size low;
 * this handles ~95% of paste cases and gracefully falls back for anything
 * unrecognized by preserving the visible text.
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return ''

  // Fast path: if it doesn't look like real HTML, return as-is
  if (!/<[a-z][\s\S]*>/i.test(html)) return html

  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (!doc.body) return html
  return walk(doc.body).trim().replace(/\n{3,}/g, '\n\n')
}

function walk(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.nodeValue || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ')
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const el = node as HTMLElement
  const tag = el.tagName.toLowerCase()
  const children = () =>
    Array.from(el.childNodes).map(walk).join('')

  switch (tag) {
    case 'script':
    case 'style':
    case 'noscript':
      return ''

    case 'br':
      return '  \n'
    case 'hr':
      return '\n\n---\n\n'

    case 'h1': return `\n\n# ${children().trim()}\n\n`
    case 'h2': return `\n\n## ${children().trim()}\n\n`
    case 'h3': return `\n\n### ${children().trim()}\n\n`
    case 'h4': return `\n\n#### ${children().trim()}\n\n`
    case 'h5': return `\n\n##### ${children().trim()}\n\n`
    case 'h6': return `\n\n###### ${children().trim()}\n\n`

    case 'p':
    case 'div':
    case 'section':
    case 'article':
      return `\n\n${children().trim()}\n\n`

    case 'strong':
    case 'b':
      return `**${children()}**`
    case 'em':
    case 'i':
      return `*${children()}*`
    case 's':
    case 'strike':
    case 'del':
      return `~~${children()}~~`

    case 'code': {
      // Only inline code here; block code handled below via <pre><code>
      const parent = el.parentElement
      if (parent && parent.tagName.toLowerCase() === 'pre') return children()
      return `\`${el.textContent || ''}\``
    }

    case 'pre': {
      const codeEl = el.querySelector('code')
      const cls = codeEl?.className || ''
      const langMatch = cls.match(/(?:language|lang)-([\w+-]+)/i)
      const lang = langMatch ? langMatch[1] : ''
      const body = (codeEl?.textContent || el.textContent || '').replace(/\n$/, '')
      return `\n\n\`\`\`${lang}\n${body}\n\`\`\`\n\n`
    }

    case 'a': {
      const href = el.getAttribute('href') || ''
      const text = children().trim() || href
      return href ? `[${text}](${href})` : text
    }

    case 'img': {
      const src = el.getAttribute('src') || ''
      const alt = el.getAttribute('alt') || ''
      return src ? `![${alt}](${src})` : ''
    }

    case 'blockquote': {
      const body = children().trim()
      const quoted = body.split('\n').map((l) => `> ${l}`).join('\n')
      return `\n\n${quoted}\n\n`
    }

    case 'ul':
    case 'ol': {
      const items: string[] = []
      let n = 1
      for (const li of Array.from(el.children)) {
        if (li.tagName.toLowerCase() !== 'li') continue
        const marker = tag === 'ul' ? '-' : `${n++}.`
        const body = walk(li).trim()
        // Indent nested lines
        const indented = body.split('\n').map((l, i) => (i === 0 ? l : '  ' + l)).join('\n')
        items.push(`${marker} ${indented}`)
      }
      return `\n\n${items.join('\n')}\n\n`
    }

    case 'li':
      return children().trim()

    case 'table': {
      const rows = Array.from(el.querySelectorAll('tr'))
      if (rows.length === 0) return children()
      const cells: string[][] = rows.map((r) =>
        Array.from(r.querySelectorAll('th,td')).map((c) =>
          (c.textContent || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim(),
        ),
      )
      const width = Math.max(...cells.map((r) => r.length))
      // Pad rows to equal width
      cells.forEach((r) => { while (r.length < width) r.push('') })
      const header = cells[0]
      const rest = cells.slice(1)
      const line = (r: string[]) => `| ${r.join(' | ')} |`
      const sep = `| ${header.map(() => '---').join(' | ')} |`
      return `\n\n${[line(header), sep, ...rest.map(line)].join('\n')}\n\n`
    }

    case 'span':
    case 'font':
    case 'small':
    case 'label':
    case 'time':
    case 'mark':
    case 'ins':
    case 'sub':
    case 'sup':
    default:
      return children()
  }
}
