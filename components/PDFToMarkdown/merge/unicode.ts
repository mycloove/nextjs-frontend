/* ── Markdown Merge — Bijoy detection & Unicode tidy-up (client) ───────────
   This file is the *client* half of the Bijoy story in Mr. Markdown. It does
   two honest things:

   1. `detectBijoy` — a local, conservative gate. The merge dialog must decide
      *whether* to spend a `/api/bijoy-convert` call (each call passes a quota
      gate), so it cannot ask the server about every source. The heuristic
      mirrors the backend's `_looks_like_bijoy` (features/bijoy_text.py) so the
      client and server agree; the server's returned `detected_bijoy` stays the
      authority for the badge.
   2. `normalizeBangla`, `toNfc` — canonicalise converted output exactly as the
      backend's `_normalize_bangla` does (NFC, virama runs, trailing spaces).

   Detection never converts. Conversion is injected as a transport into the
   session hook so the engine stays pure and unit-testable. */

/**
 * Windows-1252 glyphs the Bijoy/SutonnyMJ encoding uses for kar and juktakkhor
 * forms — near-absent from ordinary English prose, so one hit is a strong
 * signal. Mirrors `_BIJOY_EXTENDED` in the backend.
 */
const BIJOY_EXTENDED = new Set(
  Array.from(
    '†‡‰Š‹ŒŽ‘’“”•–—˜™š›œžŸƒ„…¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿' +
      'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþ',
  ),
)

/**
 * Whether text very likely came from a legacy Bijoy source.
 *
 * Already-Unicode Bengali is explicitly *not* Bijoy: a document that contains
 * any Bengali code point is left alone, so a mixed Unicode document with a
 * stray smart quote is never sent for conversion. Beyond that the signals match
 * the shared `_looks_like_bijoy`: an extended Windows-1252 glyph, or an
 * ASCII-dominant run that is vowel-starved and heavy in the `v`/`w`/`y`/`x`/`z`
 * kar marks (Bijoy vowels are those glyphs, not `a`/`e`/`i`/`o`/`u`).
 */
export function detectBijoy(text: string): boolean {
  if (!text || !text.trim()) return false
  // Already Unicode Bengali — nothing to convert.
  if (/[\u0980-\u09ff]/.test(text)) return false

  for (const ch of text) if (BIJOY_EXTENDED.has(ch)) return true

  if (text.trim().length < 3) return false

  let lower = 0
  let vowels = 0
  let marks = 0
  let hasV = false
  for (const ch of text) {
    if (ch >= 'a' && ch <= 'z') {
      lower++
      if ('aeiou'.includes(ch)) vowels++
      if ('vwxyz'.includes(ch)) marks++
      if (ch === 'v') hasV = true
    }
  }
  if (!lower) return false

  const ratio = vowels / lower
  if (ratio < 0.22 && marks >= 2) return true
  if (hasV && ratio < 0.3) return true

  return false
}

/** Canonical composed form — the codepoints readers, search and copy expect. */
export const toNfc = (text: string): string => text.normalize('NFC')

const HALANT = '\u09cd'
const HALANT_RUN = new RegExp(HALANT + '{2,}', 'g')
const TRAILING_SPACE = /[ \t]+\n/g
const BLANK_RUN = /\n{3,}/g

/**
 * Tidy the shapes the conversion engine can leave behind, mirroring the
 * backend's `_normalize_bangla` so a browser pass and a server pass agree.
 */
export function normalizeBangla(text: string): string {
  return text
    .normalize('NFC')
    .replace(HALANT_RUN, HALANT)
    .replace(TRAILING_SPACE, '\n')
    .replace(BLANK_RUN, '\n\n')
}

/** The transport the session hook injects; kept here so callers share one shape. */
export type BijoyTransport = (text: string) => Promise<{ text: string; detected: boolean }>
