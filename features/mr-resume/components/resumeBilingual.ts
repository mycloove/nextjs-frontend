import { nameLexicon, resumePhrases } from './banglishLexicon.ts'

export type BilingualSuggestion = { value: string; replacements: number; supportedOnly: true }

/** Curated phrase/name suggestions and exact session-source restoration only.
 * Unknown prose is never translated, transliterated or sent off this device. */
export function suggestBilingualText(value: string, target: 'English' | 'Bangla', options: {
  name?: boolean
  sources?: readonly { start: number; end: number; source: string; reading: string }[]
} = {}): BilingualSuggestion {
  const display = (text: string) => text.split(' ').map((word, index) => {
    if (/^(ssc|hsc|bsc|bba|mba)$/u.test(word)) return word.toUpperCase()
    if (word === 'b.sc.') return 'B.Sc.'
    if (index > 0 && /^(of|and|in)$/u.test(word)) return word
    return word[0].toUpperCase() + word.slice(1)
  }).join(' ')
  const pairs = new Map<string, string>()
  for (const bank of options.name ? [resumePhrases, nameLexicon] : [resumePhrases]) {
    for (const [english, bangla] of Object.entries(bank)) {
      const key = target === 'Bangla' ? english : bangla
      // The first curated alias is canonical; session sources can restore another.
      if (!pairs.has(key.toLowerCase())) pairs.set(key.toLowerCase(), target === 'Bangla' ? bangla : display(english))
    }
  }

  const protectedRanges: { start: number; end: number }[] = []
  const protect = (start: number, end: number) => { protectedRanges.push({ start, end }) }
  let fence: { start: number; marker: string; length: number } | null = null
  for (const match of value.matchAll(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n|$)/gm)) {
    if (!fence) fence = { start: match.index, marker: match[1][0], length: match[1].length }
    else if (match[1][0] === fence.marker && match[1].length >= fence.length && !match[2].trim()) {
      protect(fence.start, match.index + match[0].length)
      fence = null
    }
  }
  if (fence) protect(fence.start, value.length)
  for (const pattern of [
    /(`+)(?!`)[\s\S]*?\1(?!`)/g,
    /^(?: {4}|\t)[^\r\n]*/gm,
    /(?:[a-z][a-z\d+.-]*:\/\/|(?:mailto|tel):|www\.)[^\s<>]+/giu,
    /[\p{L}\p{M}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{M}\p{N}-]+(?:\.[\p{L}\p{M}\p{N}-]+)*/gu,
    /(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,63}(?:\/[^\s<>]*)?/gu,
    /[@#][\p{L}\p{M}\p{N}_]+/gu,
    /(?:[A-Za-z]:\\|(?:\.\.?|~)?\/)[^\s]+/gu,
    /^ {0,3}\[[^\]\r\n]+\]:[^\r\n]*/gm,
    /\]\[[^\]\r\n]*\]/g,
  ]) {
    for (const match of value.matchAll(pattern)) {
      // B.Sc. is an explicit degree spelling, not an inferred domain name.
      if (match[0].toLowerCase() === 'b.sc' && value[match.index + match[0].length] === '.') continue
      protect(match.index, match.index + match[0].length)
    }
  }
  // Balanced destinations cover relative links, fragments, escaped parentheses
  // and optional titles as well as ordinary URLs. Visible labels remain editable.
  for (const match of value.matchAll(/\]\(/g)) {
    let end = match.index + 2
    let depth = 1
    while (end < value.length && depth) {
      if (value[end] === '\\') { end += 2; continue }
      if (value[end] === '(') depth++
      if (value[end] === ')') depth--
      end++
    }
    protect(match.index + 1, Math.min(end, value.length))
  }
  for (const match of value.matchAll(/[\p{L}\p{M}\p{N}]+(?:[._\/-][\p{L}\p{M}\p{N}]+)*/gu)) {
    const key = match[0].toLowerCase()
    if (pairs.has(key) || (key === 'b.sc' && value[match.index + match[0].length] === '.')) continue
    if (/[\p{N}._\/-]/u.test(match[0])) protect(match.index, match.index + match[0].length)
  }
  // Explicit address/contact fields are opaque values, not name suggestions.
  for (const match of value.matchAll(/(?:\b(?:current address|permanent address|address|e-?mail|phone(?: number)?|mobile|tel)\b|(?:\u09ac\u09b0\u09cd\u09a4\u09ae\u09be\u09a8 \u09a0\u09bf\u0995\u09be\u09a8\u09be|\u09b8\u09cd\u09a5\u09be\u09af\u09bc\u09c0 \u09a0\u09bf\u0995\u09be\u09a8\u09be|\u09a0\u09bf\u0995\u09be\u09a8\u09be|\u0987\u09ae\u09c7\u0987\u09b2|\u09ab\u09cb\u09a8 \u09a8\u09ae\u09cd\u09ac\u09b0|\u09ab\u09cb\u09a8))[ \t]*:[ \t]*([^\r\n]*)/giu)) {
    protect(match.index + match[0].length - match[1].length, match.index + match[0].length)
  }

  const overlaps = (start: number, end: number, other: { start: number; end: number }) => start < other.end && end > other.start
  const boundary = (start: number, end: number) => {
    const before = start > 0 ? value.slice(Math.max(0, start - 2), start).match(/[\s\S]$/u)?.[0] ?? '' : ''
    const after = end < value.length ? String.fromCodePoint(value.codePointAt(end)!) : ''
    const word = /[\p{L}\p{M}\p{N}\u200c\u200d]/u
    if (word.test(before + after)) return false
    if ((before === '_' || after === '_') && !(before === '_' && after === '_')) return false
    // Outer quotation marks are punctuation; an apostrophe within a word is not.
    if (/['\u2019]/u.test(before) && word.test(value.slice(Math.max(0, start - 3), start - 1).match(/[\s\S]$/u)?.[0] ?? '')) return false
    if (/['\u2019]/u.test(after) && word.test(value.slice(end + 1).match(/^[\s\S]/u)?.[0] ?? '')) return false
    return true
  }
  const eligible = (start: number, end: number) => boundary(start, end) && !protectedRanges.some((range) => overlaps(start, end, range))
  const validSources = target === 'English' ? (options.sources ?? []).filter((source) => Number.isInteger(source.start) && Number.isInteger(source.end)
    && source.start >= 0 && source.end > source.start && source.end <= value.length
    && typeof source.source === 'string' && typeof source.reading === 'string'
    && /^[\u0980-\u09ff\u200c\u200d -]+$/u.test(source.reading) && /[\u0980-\u09ff]/u.test(source.reading)
    && /^\p{Script=Latin}[\p{Script=Latin}\p{M}]*(?:[ '\u2019-]\p{Script=Latin}[\p{Script=Latin}\p{M}]*)*$/u.test(source.source)
    && value.slice(source.start, source.end) === source.reading && eligible(source.start, source.end)) : []
  // Conflicting overlaps cannot both describe the genuine original: ignore them.
  const sources = validSources.filter((source) => !validSources.some((other) => overlaps(source.start, source.end, other)
    && (source.start !== other.start || source.end !== other.end || source.source !== other.source)))
  const edits = sources.map((source) => ({ start: source.start, end: source.end, replacement: source.source }))
  const keys = [...pairs.keys()].sort((a, b) => b.length - a.length).map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(keys.join('|'), 'giu')
  for (const match of value.matchAll(pattern)) {
    const start = match.index
    const end = start + match[0].length
    const replacement = pairs.get(match[0].toLowerCase())!
    if (replacement !== match[0] && eligible(start, end) && !sources.some((source) => overlaps(start, end, source))) {
      edits.push({ start, end, replacement })
    }
  }
  // Every edit addresses the ORIGINAL UTF16 string. Insertions are never scanned
  // again, so restorations and duplicate aliases cannot cause reentrant changes.
  let next = ''
  let cursor = 0
  let replacements = 0
  for (const edit of edits.sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (edit.start < cursor) continue
    next += value.slice(cursor, edit.start) + edit.replacement
    cursor = edit.end
    replacements++
  }
  return { value: next + value.slice(cursor), replacements, supportedOnly: true }
}
