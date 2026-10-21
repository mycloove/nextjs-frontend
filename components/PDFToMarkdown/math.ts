/* LaTeX math rendering for Mr. Markdown.
 *
 * Feature-isolated module: knows nothing about other Mr. Markdown files.
 * Contract (consumed by utils.ts):
 *   1. extractMath() runs BEFORE Markdown processing and replaces every math
 *      span ($...$, $$...$$ incl. multi-line, \(...\), \[...\]) with an inert
 *      \u0000 token, so $, *, _ and backslashes inside formulas never collide
 *      with Markdown syntax (same protection contract as fenced code blocks).
 *   2. restoreMathTokens() runs AFTER Markdown processing and swaps tokens for
 *      KaTeX-rendered markup. Display math that ended up alone inside a
 *      paragraph is unwrapped into a block-level element.
 *
 * Deliberately never rendered:
 *   - inside fenced code blocks or inline code spans,
 *   - escaped dollars (\$) and currency like "costs $5 and $10"
 *     (pandoc-style guards: no whitespace after the opening $ / before the
 *     closing $, and no digit right after the closing $).
 */
import katex from 'katex'

export interface MathToken {
  token: string
  tex: string
  display: boolean
}

export interface ExtractedMath {
  text: string
  tokens: MathToken[]
}

/** Rendered KaTeX output always carries this class — used for export detection. */
export const KATEX_CLASS = 'katex'

/** Keep in sync with package.json; used for the standalone HTML export CDN link. */
export const KATEX_VERSION = '0.18.0'

const FENCE = /^```/

// \u0000 never appears in normal Markdown and survives every transform in the
// pipeline (escapeHtml, bold, italic, link, table, heading rules) untouched.
const mathToken = (index: number): string => `\u0000M${index}\u0000`
const codeToken = (index: number): string => `\u0000C${index}\u0000`
const CODE_SPAN = /`[^`]*`/g
const CODE_TOKEN_REF = /\u0000C(\d+)\u0000/g

// Inline $...$: opening $ not escaped, not followed by whitespace; closing $
// not preceded by whitespace, not followed by a digit; single line, no $ inside.
const INLINE_DOLLAR = /(?<![\\$])\$(?!\s)((?:\\.|[^$\n])+?)(?<!\s)\$(?!\d)/g
const INLINE_PAREN = /\\\(((?:\\.|[^)\\\n])+?)\\\)/g

const DISPLAY_DELIMS: readonly DisplayDelim[] = [
  { open: '$$', close: '$$' },
  { open: '\\[', close: '\\]' },
]

interface DisplayDelim {
  open: string
  close: string
}

const findOpen = (line: string, from: number): { start: number; delim: DisplayDelim } | null => {
  let best: { start: number; delim: DisplayDelim } | null = null
  for (const delim of DISPLAY_DELIMS) {
    const at = line.indexOf(delim.open, from)
    if (at === -1 || line[at - 1] === '\\') continue
    if (!best || at < best.start) best = { start: at, delim }
  }
  return best
}

const findClose = (line: string, delim: DisplayDelim, from: number): number => {
  let at = line.indexOf(delim.close, from)
  while (at !== -1 && line[at - 1] === '\\') at = line.indexOf(delim.close, at + 1)
  return at
}

/**
 * Bracket-style math delimiters (\[...\], \(...\)) collide with Markdown's
 * escaped brackets. Plain-word content ("Not a link") is an escaped bracket;
 * only TeX-looking content (commands, ^ _ = {} , operators, bare numbers) is
 * treated as math.
 */
const isLikelyTex = (tex: string): boolean =>
  /\\[a-zA-Z]+|[=^_{}]/.test(tex) || /\d\s*[-+*/]/.test(tex) || /^[\s\d.]+$/.test(tex)

/**
 * Replaces display math with tokens, line-aware so a `$$` block may span
 * lines (including inside a blockquote, where `> ` is stripped from the TeX)
 * but never crosses a code fence (fences are excluded by the caller).
 */
const extractDisplayMath = (
  lines: string[],
  nextToken: (tex: string, display: boolean) => string,
): string[] => {
  const out: string[] = []
  let i = 0
  lineLoop: while (i < lines.length) {
    let rest = lines[i]
    let emitted = ''
    for (;;) {
      const open = findOpen(rest, 0)
      if (!open) break
      const openLen = open.delim.open.length
      const closeAt = findClose(rest, open.delim, open.start + openLen)
      // A bracket-style opener with plain-word content is a Markdown escaped
      // bracket ("\[Not a link\]"), not display math — emit it literally.
      if (
        open.delim.open === '\\[' &&
        closeAt !== -1 &&
        !isLikelyTex(rest.slice(open.start + openLen, closeAt))
      ) {
        emitted += rest.slice(0, open.start + openLen)
        rest = rest.slice(open.start + openLen)
        continue
      }
      if (closeAt !== -1) {
        const tex = rest.slice(open.start + openLen, closeAt)
        if (tex.trim()) {
          emitted += rest.slice(0, open.start) + nextToken(tex, true)
          rest = rest.slice(closeAt + open.delim.close.length)
          continue
        }
      }
      // No same-line closer — treat as a multi-line block: collect TeX until
      // the closing delimiter (quote prefixes stripped), keep the text before
      // the opener on its line and any text after the closer.
      const prefix = rest.slice(0, open.start)
      const tail = rest.slice(open.start + openLen)
      const texLines: string[] = tail.trim() ? [tail] : []
      let j = i + 1
      while (j < lines.length) {
        const stripped = lines[j].replace(/^\s*>\s?/, '')
        const closeIdx = findClose(stripped, open.delim, 0)
        if (closeIdx !== -1) {
          const head = stripped.slice(0, closeIdx)
          if (head.trim()) texLines.push(head)
          emitted += prefix + nextToken(texLines.join('\n'), true) + stripped.slice(closeIdx + open.delim.close.length)
          out.push(emitted)
          i = j + 1
          continue lineLoop
        }
        texLines.push(stripped)
        j++
      }
      // Unterminated block — leave the source untouched.
      emitted += rest
      rest = ''
      break
    }
    out.push(emitted + rest)
    i++
  }
  return out
}

export const extractMath = (src: string): ExtractedMath => {
  if (!src.includes('$') && !src.includes('\\(') && !src.includes('\\[')) {
    return { text: src, tokens: [] }
  }
  const tokens: MathToken[] = []
  const nextToken = (tex: string, display: boolean): string => {
    const token = mathToken(tokens.length)
    tokens.push({ token, tex, display })
    return token
  }

  // 1) Protect inline code spans: math inside `...` is code, not math.
  const codes: string[] = []
  let inFence = false
  const masked = src.split('\n').map((line) => {
    if (FENCE.test(line)) {
      inFence = !inFence
      return line
    }
    if (inFence) return line
    return line.replace(CODE_SPAN, (span) => {
      codes.push(span)
      return codeToken(codes.length - 1)
    })
  })

  // 2) Display math per run of non-fence lines (never crosses a code fence).
  const processed: string[] = []
  let segment: string[] = []
  inFence = false
  const flushSegment = () => {
    if (segment.length) {
      processed.push(...extractDisplayMath(segment, nextToken))
      segment = []
    }
  }
  for (const line of masked) {
    if (FENCE.test(line)) {
      flushSegment()
      inFence = !inFence
      processed.push(line)
    } else if (inFence) {
      processed.push(line)
    } else {
      segment.push(line)
    }
  }
  flushSegment()

  // 3) Inline math per line (bracket-form only when the content looks like TeX).
  const finalLines = processed.map((line) => (
    line
      .replace(INLINE_DOLLAR, (_match, tex: string) => nextToken(tex, false))
      .replace(INLINE_PAREN, (match, tex: string) => (isLikelyTex(tex) ? nextToken(tex, false) : match))
  ))

  // 4) Restore code spans verbatim for normal Markdown rendering.
  const text = finalLines.join('\n').replace(CODE_TOKEN_REF, (_match, index: string) => codes[Number(index)])
  return { text, tokens }
}

/* ── KaTeX rendering ─────────────────────────────────────────────
 * throwOnError: false keeps broken TeX visible (red source) instead of
 * crashing the preview. strict: false accepts common non-strict LaTeX.
 * trust: false (default, explicit) blocks \href/\url/\includegraphics so
 * user math can never inject links or assets.
 * The default output (HTML + MathML) keeps formulas accessible and copyable.
 * Results are cached — live preview re-renders on every keystroke.
 * ─────────────────────────────────────────────────────────────── */
const renderCache = new Map<string, string>()
const RENDER_CACHE_LIMIT = 500

const escapePlainText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const renderTexToHtml = (tex: string, displayMode: boolean): string => {
  const key = `${displayMode ? 'd' : 'i'}\u0000${tex}`
  const cached = renderCache.get(key)
  if (cached !== undefined) return cached
  let html: string
  try {
    html = katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      errorColor: '#b91c1c',
      strict: false,
      trust: false,
    })
  } catch {
    // renderToString with throwOnError:false should not throw, but never let
    // one bad formula break the whole document.
    html = `<code class="pm-math-error">${escapePlainText(tex)}</code>`
  }
  if (renderCache.size >= RENDER_CACHE_LIMIT) renderCache.clear()
  renderCache.set(key, html)
  return html
}

export const restoreMathTokens = (html: string, tokens: MathToken[]): string => {
  if (!tokens.length) return html
  let result = html
  for (const { token, tex, display } of tokens) {
    const rendered = renderTexToHtml(tex, display)
    // A display token alone in a paragraph becomes a real block element.
    if (display && result.includes(`<p>${token}</p>`)) {
      result = result.split(`<p>${token}</p>`).join(`<div class="pm-math pm-math-block">${rendered}</div>`)
    }
    result = result.split(token).join(`<span class="pm-math pm-math-inline">${rendered}</span>`)
  }
  return result
}

