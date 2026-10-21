/**
 * W2 — Script rendering capability.
 *
 * An earlier version of this module asserted that `page.drawText()` "applies no
 * OpenType layout: no GSUB, no GPOS", and on that basis refused every Indic
 * script outright. That assertion was tested against the real dependencies and
 * is **false for embedded fonts**. See `docs/pdf-editor-shaping-findings.md` for
 * the raw measurements.
 *
 * What actually happens: `pdf-lib`'s `CustomFontEmbedder.encodeText()` calls
 * fontkit's `font.layout()`, which runs the full OpenType pipeline. Measured
 * with `subset: false`, so glyph ids are not renumbered:
 *
 *   - "কি" (U+0995 U+09BF) encodes to glyphs [55, 20], not the stored order
 *     [20, 55]. The vowel sign is correctly placed *before* the consonant.
 *   - "ক্ষ" (U+0995 U+09CD U+09B7) encodes to a *single* glyph [129]. Three code
 *     points became one, which only GSUB can do.
 *
 * The resulting PDF carries `/Type0` + `/CIDFontType2` + `/ToUnicode`, so the
 * text stays searchable and copyable rather than being flattened to outlines.
 *
 * Two real constraints remain, and they are different from each other:
 *
 *   1. **Bidirectional text.** fontkit shapes a single run; it does not
 *      implement the Unicode Bidi Algorithm, which is what orders mixed
 *      LTR/RTL runs within a paragraph. "Name: <hebrew> (ID 42)" needs UBA that
 *      nothing in this stack provides, so RTL is still refused.
 *   2. **Font coverage.** A font that lacks a glyph renders `.notdef` — visible
 *      tofu, with no error raised. Shaping capability says nothing about
 *      whether the chosen font actually contains the glyphs.
 *
 * Scope note: this module answers *"can this text be positioned correctly?"*
 * only. Coverage is a separate question answered against the specific font at
 * embed time (`editorFontPolicy.ts`). Both must pass. Because a coverage miss
 * fails silently while a placement miss fails loudly, coverage is the more
 * dangerous of the two and must never be inferred from this result.
 */

export type ScriptRenderingCapability =
  /**
   * Encodable by the built-in PDF standard fonts (WinAnsi). No embedding needed.
   */
  | 'standard-font'
  /**
   * One code point maps to one glyph, laid out left to right. Correct once a
   * font containing the glyphs is embedded.
   */
  | 'embeddable-simple'
  /**
   * Needs OpenType shaping — glyph substitution, conjunct formation, mark
   * positioning or vowel reordering. Correct once a font containing the glyphs
   * is embedded, because the embedder shapes through fontkit.
   */
  | 'embeddable-shaped'
  /**
   * Needs bidirectional reordering across runs, which this renderer does not
   * implement. Cannot be placed correctly with any font.
   */
  | 'requires-bidi';

/**
 * Ranges that need bidirectional handling. These are refused: the missing piece
 * is the Unicode Bidi Algorithm, not the font.
 */
const BIDI_REQUIRED_RANGES: ReadonlyArray<readonly [number, number, string]> = [
  // Invisible controls whose only purpose is to override direction. Their
  // presence means the author expects reordering we do not perform.
  [0x200e, 0x200f, 'left-to-right and right-to-left marks only take effect during bidirectional reordering'],
  [0x202a, 0x202e, 'bidirectional overrides only take effect during bidirectional reordering'],
  [0x2066, 0x2069, 'bidirectional isolates only take effect during bidirectional reordering'],

  [0x0590, 0x05ff, 'Hebrew is right-to-left and needs bidirectional reordering'],
  [0x0600, 0x06ff, 'Arabic needs letter joining and right-to-left reordering'],
  [0x0700, 0x074f, 'Syriac needs letter joining and right-to-left reordering'],
  [0x0750, 0x077f, 'Arabic needs letter joining and right-to-left reordering'],
  [0x0780, 0x07bf, 'Thaana is right-to-left and needs bidirectional reordering'],
  [0x07c0, 0x07ff, 'NKo is right-to-left and needs bidirectional reordering'],
  [0x0800, 0x083f, 'Samaritan is right-to-left and needs bidirectional reordering'],
  [0x1800, 0x18af, 'Mongolian is written vertically, which this renderer does not do'],
  [0xfb1d, 0xfdff, 'Hebrew and Arabic presentation forms need bidirectional reordering'],
  [0xfe70, 0xfeff, 'Arabic presentation forms need bidirectional reordering'],
];

/**
 * Ranges that require OpenType shaping. These are *supported* — the embedder
 * shapes them through fontkit — and are listed so the export path can tell that
 * a Unicode font must be embedded rather than falling back to WinAnsi.
 */
const SHAPED_SCRIPT_RANGES: ReadonlyArray<readonly [number, number, string]> = [
  [0x0300, 0x036f, 'combining marks are positioned by GPOS'],
  // Zero-width space / non-joiner / joiner. These direct the shaper (they break
  // or force conjuncts in Indic text) and are consumed during layout.
  [0x200b, 0x200d, 'zero-width joiners are consumed during shaping'],

  [0x0900, 0x097f, 'Devanagari conjuncts and vowel reordering are applied by GSUB'],
  [0x0980, 0x09ff, 'Bengali conjuncts and vowel reordering are applied by GSUB'],
  [0x0a00, 0x0a7f, 'Gurmukhi conjuncts and vowel reordering are applied by GSUB'],
  [0x0a80, 0x0aff, 'Gujarati conjuncts and vowel reordering are applied by GSUB'],
  [0x0b00, 0x0b7f, 'Oriya conjuncts and vowel reordering are applied by GSUB'],
  [0x0b80, 0x0bff, 'Tamil vowel reordering is applied by GSUB'],
  [0x0c00, 0x0c7f, 'Telugu conjuncts and vowel reordering are applied by GSUB'],
  [0x0c80, 0x0cff, 'Kannada conjuncts and vowel reordering are applied by GSUB'],
  [0x0d00, 0x0d7f, 'Malayalam conjuncts and vowel reordering are applied by GSUB'],
  [0x0d80, 0x0dff, 'Sinhala conjuncts and vowel reordering are applied by GSUB'],
  [0x0e00, 0x0e7f, 'Thai tone marks are stacked by GPOS'],
  [0x0e80, 0x0eff, 'Lao tone marks are stacked by GPOS'],
  [0x0f00, 0x0fff, 'Tibetan stacked consonants are composed by GSUB'],
  [0x1000, 0x109f, 'Myanmar conjuncts and vowel reordering are applied by GSUB'],
  [0x1100, 0x11ff, 'Hangul Jamo are composed into syllable blocks by GSUB'],
  [0x1780, 0x17ff, 'Khmer conjuncts and vowel reordering are applied by GSUB'],
];

/**
 * Ranges that place one glyph per code point, left to right. These render
 * correctly once the embedded font covers them.
 */
const SIMPLE_EMBEDDABLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0100, 0x024f], // Latin Extended-A/B
  [0x0370, 0x03ff], // Greek
  [0x0400, 0x04ff], // Cyrillic
  [0x0500, 0x052f], // Cyrillic Supplement
  [0x0530, 0x058f], // Armenian
  [0x10a0, 0x10ff], // Georgian
  [0x1e00, 0x1eff], // Latin Extended Additional
  [0x2000, 0x206f], // General punctuation
  [0x20a0, 0x20bf], // Currency symbols
  [0x2100, 0x214f], // Letterlike symbols
  [0x2190, 0x21ff], // Arrows
  [0x2200, 0x22ff], // Mathematical operators
  [0x2500, 0x257f], // Box drawing
  [0x25a0, 0x25ff], // Geometric shapes
  [0x2600, 0x27bf], // Misc symbols and dingbats
  [0x3000, 0x303f], // CJK symbols and punctuation
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xac00, 0xd7af], // Precomposed Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xff00, 0xffef], // Halfwidth and fullwidth forms
  [0x1f300, 0x1faff], // Emoji (simple to place; coverage is a separate matter)
];

function reasonFrom(
  codePoint: number,
  ranges: ReadonlyArray<readonly [number, number, string]>,
): string | undefined {
  for (const [start, end, reason] of ranges) {
    if (codePoint >= start && codePoint <= end) return reason;
  }
  return undefined;
}

function inAnyRange(
  codePoint: number,
  ranges: ReadonlyArray<readonly [number, number]>,
): boolean {
  return ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/** The bidi reason for a code point, or `undefined` if none applies. */
export function bidiReasonForCodePoint(codePoint: number): string | undefined {
  return reasonFrom(codePoint, BIDI_REQUIRED_RANGES);
}

/** The shaping reason for a code point, or `undefined` if none applies. */
export function shapingReasonForCodePoint(codePoint: number): string | undefined {
  return reasonFrom(codePoint, SHAPED_SCRIPT_RANGES);
}

/**
 * Classifies a single code point by how it must be laid out.
 *
 * Bidi is checked first because it is the only unrecoverable case: a code point
 * that needs reordering across runs cannot be rescued by embedding a font.
 * Shaping is checked next so that a narrow range (Hangul Jamo) is not absorbed
 * by the broader block it shares with simple code points (precomposed Hangul).
 */
export function classifyCodePointCapability(codePoint: number): ScriptRenderingCapability {
  if (bidiReasonForCodePoint(codePoint) !== undefined) return 'requires-bidi';
  if (shapingReasonForCodePoint(codePoint) !== undefined) return 'embeddable-shaped';

  // WinAnsi covers ASCII and the Latin-1 supplement, which the built-in fonts
  // can encode without embedding anything.
  const isAscii = codePoint >= 0x20 && codePoint <= 0x7e;
  const isLatin1Supplement = codePoint >= 0xa0 && codePoint <= 0xff;
  const isCommonWhitespace = codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d;
  if (isAscii || isLatin1Supplement || isCommonWhitespace) return 'standard-font';

  if (inAnyRange(codePoint, SIMPLE_EMBEDDABLE_RANGES)) return 'embeddable-simple';

  // Unknown territory. Claiming a code point is safe to place when we have not
  // classified it is how malformed text ships, so refuse it.
  return 'requires-bidi';
}

export type RenderingBlocker = {
  char: string;
  codePoint: number;
  /** Index within the authored string, counted in code points. */
  index: number;
  reason: string;
};

export type TextRenderingRequirement = {
  /** The most demanding capability required by any character in the text. */
  capability: ScriptRenderingCapability;
  /** True when a Unicode font must be embedded rather than using WinAnsi. */
  needsFontEmbedding: boolean;
  /**
   * True when the text needs OpenType shaping. This is **supported**; it is
   * reported so the export path can require a shaping-capable embedder rather
   * than a naive one.
   */
  needsShaping: boolean;
  /** Every character that cannot be placed correctly, in order of appearance. */
  blockers: RenderingBlocker[];
  /** Distinct human-readable blocker reasons, deduplicated and sorted. */
  reasons: string[];
};

/**
 * Determines what would be needed to render `text` correctly.
 *
 * The result is the worst case across the string: one Hebrew word inside an
 * otherwise Latin paragraph still blocks the paragraph, because that word would
 * come out reversed.
 */
export function assessTextRendering(text: string): TextRenderingRequirement {
  const blockers: RenderingBlocker[] = [];
  const reasons = new Set<string>();
  let needsEmbedding = false;
  let needsShaping = false;
  let index = 0;

  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    const capability = classifyCodePointCapability(codePoint);

    if (capability === 'requires-bidi') {
      const reason = bidiReasonForCodePoint(codePoint)
        ?? 'this character is outside the ranges known to lay out correctly';
      blockers.push({ char, codePoint, index, reason });
      reasons.add(reason);
    } else if (capability === 'embeddable-shaped') {
      needsEmbedding = true;
      needsShaping = true;
    } else if (capability === 'embeddable-simple') {
      needsEmbedding = true;
    }

    index += 1;
  }

  const capability: ScriptRenderingCapability = blockers.length > 0
    ? 'requires-bidi'
    : needsShaping
      ? 'embeddable-shaped'
      : needsEmbedding
        ? 'embeddable-simple'
        : 'standard-font';

  return {
    capability,
    needsFontEmbedding: capability === 'embeddable-simple' || capability === 'embeddable-shaped',
    needsShaping,
    blockers,
    reasons: [...reasons].sort(),
  };
}

export type TextRenderingRoute =
  /** Draw with the built-in standard fonts. */
  | 'built-in-font'
  /** Embed a Unicode font covering these glyphs, then draw. */
  | 'embed-unicode-font'
  /**
   * Embed a Unicode font and shape through fontkit. Same call as
   * `embed-unicode-font`, kept distinct so the export path can assert that a
   * shaping-capable embedder is actually in use before writing complex text.
   */
  | 'embed-and-shape'
  /** Refuse. No font makes this correct in this renderer. */
  | 'refuse-unsupported-script';

/**
 * Chooses how the export path should handle this text.
 *
 * There is deliberately no "try anyway" route. Drawing reversed Hebrew produces
 * a file that looks finished and is wrong, and the editor must not hand a user
 * malformed text while reporting success.
 */
export function decideTextRenderingRoute(
  requirement: TextRenderingRequirement,
): TextRenderingRoute {
  if (requirement.blockers.length > 0) return 'refuse-unsupported-script';
  if (requirement.needsShaping) return 'embed-and-shape';
  if (requirement.needsFontEmbedding) return 'embed-unicode-font';
  return 'built-in-font';
}

/**
 * A user-facing explanation. It names the actual problem, because "export
 * failed" gives the user nothing to act on, and "8 characters were replaced"
 * hides the fact that their sentence is gone.
 */
export function describeTextRenderingRequirement(
  requirement: TextRenderingRequirement,
): string {
  if (requirement.capability === 'standard-font') {
    return 'This text can be written with the built-in fonts.';
  }

  if (requirement.capability === 'embeddable-simple') {
    return 'This text needs a Unicode font embedded in the PDF; the characters will be written exactly as typed.';
  }

  if (requirement.capability === 'embeddable-shaped') {
    return 'This text needs a Unicode font embedded and shaped; conjuncts and vowel signs will be positioned by the font\u2019s OpenType rules.';
  }

  const sample = requirement.blockers
    .slice(0, 8)
    .map((blocker) => blocker.char)
    .join('');
  const count = requirement.blockers.length;

  return `${count} character(s) in this text cannot be written correctly by the editor (for example "${sample}"). `
    + `${requirement.reasons.join('; ')}. `
    + 'Writing them anyway would place the letters in the wrong order, so the edit was not applied.';
}

/**
 * True when the text can be placed exactly as authored, whether that needs
 * embedding, shaping, or neither. False only when the editor must refuse.
 */
export function canRenderTextFaithfully(text: string): boolean {
  return assessTextRendering(text).blockers.length === 0;
}
