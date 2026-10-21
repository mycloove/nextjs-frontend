/**
 * W0 — Font & encoding policy.
 *
 * The editor previously replaced any glyph a PDF standard font could not encode
 * with `'?'` and said nothing. For Latin text that is a cosmetic downgrade. For
 * Bengali, Devanagari, Arabic, or CJK it destroys the content outright: a user
 * types a Bangla sentence, the export succeeds, and the PDF contains `????????`.
 *
 * This module keeps that substitution behaviour byte-for-byte identical (so the
 * existing export path does not change shape) but makes it *reportable*. Export
 * can then disclose the downgrade, or refuse and route to an embedded Unicode
 * font instead. Silence is the only outcome that is not allowed.
 */

/**
 * Typographic characters that have a faithful ASCII-range equivalent. Replacing
 * these is lossless in meaning, so they are reported as `normalized`, not lost.
 */
export const PDF_STANDARD_FONT_CHAR_FALLBACKS: Record<string, string> = {
  '\uf0b7': '•',
  '\uf0a7': '▪',
  '\uf0d8': '➢',
  '\uf0fc': '✓',
  '\uf0fe': '■',
  '\u2010': '-',
  '\u2011': '-',
  '\u2012': '-',
  '\u2013': '-',
  '\u2014': '-',
  '\u2018': "'",
  '\u2019': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u2026': '...',
  '\u00a0': ' ',
};

/** Emitted when a glyph cannot be encoded at all. This destroys information. */
export const UNSUPPORTED_GLYPH_PLACEHOLDER = '?';

export type GlyphResolution =
  /** Encoded as authored. */
  | 'exact'
  /** Swapped for a faithful equivalent (curly quote -> straight quote). */
  | 'normalized'
  /** Control whitespace folded to a space, matching legacy behaviour. */
  | 'whitespace'
  /** Could not be encoded; replaced by a placeholder. Information is lost. */
  | 'dropped';

export type GlyphOutcome = {
  /** The authored character (may be a multi-code-unit code point). */
  char: string;
  codePoint: number;
  /** What was actually written to the PDF. */
  emitted: string;
  resolution: GlyphResolution;
  /** Index within the authored string, counted in code points. */
  index: number;
  /** Unicode script this character belongs to, when it is not plain Latin. */
  script?: string;
};

export type TextEncodingStatus =
  /** Everything encoded as authored. */
  | 'exact'
  /** Only faithful equivalents were substituted; still fully readable. */
  | 'substituted'
  /** At least one character was replaced by a placeholder. Content lost. */
  | 'lossy';

export type TextEncodingPlan = {
  /** Text safe to hand to the standard font, identical to legacy output. */
  text: string;
  status: TextEncodingStatus;
  /** Only the characters that were not encoded exactly. */
  changes: GlyphOutcome[];
  /** Scripts present in the authored text that the standard fonts cannot serve. */
  unsupportedScripts: string[];
  /** Count of characters replaced by a placeholder. */
  droppedCount: number;
};

type EncodeCapableFont = { encodeText: (text: string) => unknown };

const SCRIPT_RANGES: ReadonlyArray<readonly [number, number, string]> = [
  [0x0370, 0x03ff, 'Greek'],
  [0x0400, 0x04ff, 'Cyrillic'],
  [0x0590, 0x05ff, 'Hebrew'],
  [0x0600, 0x06ff, 'Arabic'],
  [0x0700, 0x074f, 'Syriac'],
  [0x0750, 0x077f, 'Arabic'],
  [0x0900, 0x097f, 'Devanagari'],
  [0x0980, 0x09ff, 'Bengali'],
  [0x0a00, 0x0a7f, 'Gurmukhi'],
  [0x0a80, 0x0aff, 'Gujarati'],
  [0x0b00, 0x0b7f, 'Oriya'],
  [0x0b80, 0x0bff, 'Tamil'],
  [0x0c00, 0x0c7f, 'Telugu'],
  [0x0c80, 0x0cff, 'Kannada'],
  [0x0d00, 0x0d7f, 'Malayalam'],
  [0x0d80, 0x0dff, 'Sinhala'],
  [0x0e00, 0x0e7f, 'Thai'],
  [0x0e80, 0x0eff, 'Lao'],
  [0x1000, 0x109f, 'Myanmar'],
  [0x10a0, 0x10ff, 'Georgian'],
  [0x1100, 0x11ff, 'Hangul'],
  [0x1780, 0x17ff, 'Khmer'],
  [0x2600, 0x27bf, 'Symbols'],
  [0x3040, 0x309f, 'Hiragana'],
  [0x30a0, 0x30ff, 'Katakana'],
  [0x3400, 0x4dbf, 'CJK'],
  [0x4e00, 0x9fff, 'CJK'],
  [0xac00, 0xd7af, 'Hangul'],
  [0x1f300, 0x1faff, 'Emoji'],
];

/** Resolves the Unicode script for a code point, or `undefined` for Latin/ASCII. */
export function scriptOfCodePoint(codePoint: number): string | undefined {
  for (const [start, end, script] of SCRIPT_RANGES) {
    if (codePoint >= start && codePoint <= end) return script;
  }
  return undefined;
}

/** Lists the non-Latin scripts present in a string, sorted for stable output. */
export function detectTextScripts(text: string): string[] {
  const scripts = new Set<string>();
  for (const char of text) {
    const script = scriptOfCodePoint(char.codePointAt(0) ?? 0);
    if (script) scripts.add(script);
  }
  return [...scripts].sort();
}

/**
 * Plans how `text` will be written using a PDF standard font.
 *
 * `plan.text` is byte-for-byte what the legacy `makeStandardFontSafeText`
 * produced, so this can replace it without changing any existing output. The
 * difference is that callers can now see what the substitution cost.
 */
export function planStandardFontText(
  text: string,
  font: EncodeCapableFont,
): TextEncodingPlan {
  const changes: GlyphOutcome[] = [];
  const unsupportedScripts = new Set<string>();
  let out = '';
  let droppedCount = 0;
  let index = 0;

  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    const script = scriptOfCodePoint(codePoint);
    const fallback = PDF_STANDARD_FONT_CHAR_FALLBACKS[char];
    const candidate = fallback ?? char;

    if (candidate === '\r' || candidate === '\n' || candidate === '\t') {
      out += ' ';
      changes.push({ char, codePoint, emitted: ' ', resolution: 'whitespace', index, script });
      index += 1;
      continue;
    }

    let encodable = true;
    try {
      font.encodeText(candidate);
    } catch {
      encodable = false;
    }

    if (!encodable) {
      out += UNSUPPORTED_GLYPH_PLACEHOLDER;
      droppedCount += 1;
      if (script) unsupportedScripts.add(script);
      changes.push({
        char,
        codePoint,
        emitted: UNSUPPORTED_GLYPH_PLACEHOLDER,
        resolution: 'dropped',
        index,
        script,
      });
      index += 1;
      continue;
    }

    out += candidate;
    if (candidate !== char) {
      changes.push({ char, codePoint, emitted: candidate, resolution: 'normalized', index, script });
    }
    index += 1;
  }

  const status: TextEncodingStatus = droppedCount > 0
    ? 'lossy'
    : changes.some((change) => change.resolution === 'normalized')
      ? 'substituted'
      : 'exact';

  return {
    text: out,
    status,
    changes,
    unsupportedScripts: [...unsupportedScripts].sort(),
    droppedCount,
  };
}

/**
 * True when the text contains characters outside the standard fonts' reach, so
 * an embedded Unicode font is required to keep the content intact.
 */
export function requiresEmbeddedUnicodeFont(plan: TextEncodingPlan): boolean {
  return plan.status === 'lossy';
}

/**
 * A sentence the UI can show before the user commits to an export. It names the
 * script when we know it, because "8 characters cannot be displayed" is far less
 * actionable than "Bengali text cannot be displayed".
 */
export function describeTextEncodingPlan(plan: TextEncodingPlan): string {
  if (plan.status === 'exact') return 'All characters can be written with the built-in fonts.';

  if (plan.status === 'substituted') {
    return `${plan.changes.length} character(s) were replaced with equivalents (for example curly quotes became straight quotes).`;
  }

  const scripts = plan.unsupportedScripts;
  const subject = scripts.length > 0 ? `${scripts.join(', ')} text` : 'Some characters';
  return `${subject} cannot be written with the built-in fonts. ${plan.droppedCount} character(s) would be replaced with "${UNSUPPORTED_GLYPH_PLACEHOLDER}" and the original content would be lost. Embed a Unicode font to keep it.`;
}
