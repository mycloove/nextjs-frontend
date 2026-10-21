/**
 * W0 — Content-removal verification.
 *
 * The editor's "structure-preserving" export appends a white rectangle and new
 * text on top of the page. It never touches the original content stream. So when
 * a user edits or deletes text, the original glyphs are still in the file: hidden
 * from view, but recoverable by copy/paste, `pdftotext`, or any PDF parser.
 *
 * This module reads the *output* bytes and answers one question: is the text the
 * user believed they removed still being drawn on the page?
 *
 * Design rule — fail safe. A page this module cannot decode is reported as
 * `unverified`, never as clean. "We could not check" and "we checked and it is
 * gone" are different answers, and collapsing them is how privacy tools end up
 * lying to their users.
 *
 * Font-aware decoding — why raw operand bytes are not enough
 * ----------------------------------------------------------
 * Most real documents draw text through embedded subset fonts whose operands
 * are glyph indices (Type0/CIDFontType2 with an Identity-H code space). Those
 * indices carry no characters on their own, so a decoder that understands only
 * ASCII/UTF-16 operands sees them as opaque bytes and can never confirm that
 * redacted text is gone — every redaction on such a document was refused even
 * though the server engine had removed the glyphs correctly.
 *
 * The mapping back is in the page itself: each `/Resources /Font` entry carries
 * a `/ToUnicode` CMap. This module resolves those CMaps and decodes every text
 * operand with the font that was active when it was shown, so glyph-index text
 * becomes readable characters again. A font that still has no usable map keeps
 * the fail-safe answer: an `opaque` operand, reported as unverified.
 */

import { PDFDocument, PDFDict, PDFName, PDFRawStream, PDFArray, decodePDFRawStream } from 'pdf-lib';

/** Text-showing operators. Anything drawn as text passes through one of these. */
const TEXT_SHOWING_OPERATORS = new Set(['Tj', 'TJ', "'", '"']);

const LITERAL_ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  '(': '(',
  ')': ')',
  '\\': '\\',
};

export type StreamTextConfidence =
  /** Operands decoded as readable single-byte or UTF-16BE text. */
  | 'readable'
  /** Operands present but encoded as glyph indices we cannot map to characters. */
  | 'opaque';

export type ExtractedStreamText = {
  text: string;
  confidence: StreamTextConfidence;
  /** Number of text-showing operators seen, decodable or not. */
  showOperatorCount: number;
};

type PendingString = { value: string; readable: boolean };

/**
 * One font's character-code → Unicode mapping, resolved from a page's
 * `/Resources /Font` dictionary.
 */
export type ContentStreamFontMap = {
  /** Bytes per character code: 1 for simple fonts, 2 for Identity-H/CID fonts. */
  codeBytes: number;
  /** Character code → Unicode string. `null` when the font carries no usable map. */
  toUnicode: Map<number, string> | null;
};

/** The fonts a page can select with `Tf`, keyed by resource name (without `/`). */
export type ContentStreamFonts = Map<string, ContentStreamFontMap>;

function bytesToLatin1(bytes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

/** Interpret bytes as one big-endian character code (1–2 bytes for our use). */
function bytesToCode(bytes: number[]): number {
  let code = 0;
  for (const byte of bytes) code = (code << 8) | byte;
  return code;
}

function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const padded = clean.length % 2 === 1 ? `${clean}0` : clean;
  const bytes: number[] = [];
  for (let i = 0; i < padded.length; i += 2) {
    bytes.push(parseInt(padded.slice(i, i + 2), 16));
  }
  return bytes;
}

/** Decode a UTF-16BE CMap destination, surrogate pairs included. */
function hexToUnicode(hex: string): string {
  const bytes = hexToBytes(hex);
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  }
  return out;
}

/** Add `offset` to the last UTF-16 code unit of a CMap destination, carrying upward. */
function incrementUnicodeHex(hex: string, offset: number): string {
  const bytes = hexToBytes(hex);
  const units: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) units.push((bytes[i] << 8) | bytes[i + 1]);
  let add = offset;
  for (let i = units.length - 1; i >= 0 && add > 0; i -= 1) {
    const sum = units[i] + add;
    units[i] = sum & 0xffff;
    add = sum >>> 16;
  }
  return units.map(unit => String.fromCharCode(unit)).join('');
}

type CMapToken = { type: 'hex'; value: string } | { type: 'open' } | { type: 'close' };

function scanCMapTokens(body: string): CMapToken[] {
  const tokens: CMapToken[] = [];
  const pattern = /<([0-9a-fA-F\s]*)>|\[|\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    if (match[0] === '[') tokens.push({ type: 'open' });
    else if (match[0] === ']') tokens.push({ type: 'close' });
    else tokens.push({ type: 'hex', value: match[1] });
  }
  return tokens;
}

export type ParsedCMap = {
  codeBytes: number;
  map: Map<number, string>;
};

/**
 * Parse the `bfchar`/`bfrange` sections of a `/ToUnicode` CMap.
 *
 * Returns `null` when the stream contains nothing usable, so the caller keeps
 * the fail-safe `opaque` answer instead of inventing a mapping.
 */
export function parseToUnicodeCMap(source: string): ParsedCMap | null {
  const map = new Map<number, string>();
  let codeBytes = 0;

  // The code space fixes the width of a character code (2 for Identity-H).
  for (const section of source.matchAll(/(\d+)\s+begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    const first = /<([0-9a-fA-F\s]*)>/.exec(section[2]);
    if (first) codeBytes = Math.max(codeBytes, hexToBytes(first[1]).length);
  }

  for (const section of source.matchAll(/(\d+)\s+beginbfchar([\s\S]*?)endbfchar/g)) {
    const tokens = scanCMapTokens(section[2]);
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      const src = tokens[i];
      const dst = tokens[i + 1];
      if (src.type !== 'hex' || dst.type !== 'hex') continue;
      const srcBytes = hexToBytes(src.value);
      codeBytes = Math.max(codeBytes, srcBytes.length);
      map.set(bytesToCode(srcBytes), hexToUnicode(dst.value));
    }
  }

  for (const section of source.matchAll(/(\d+)\s+beginbfrange([\s\S]*?)endbfrange/g)) {
    const tokens = scanCMapTokens(section[2]);
    let i = 0;
    while (i + 1 < tokens.length) {
      const low = tokens[i];
      const high = tokens[i + 1];
      if (low.type !== 'hex' || high.type !== 'hex') { i += 1; continue; }
      i += 2;
      const lowBytes = hexToBytes(low.value);
      const highBytes = hexToBytes(high.value);
      codeBytes = Math.max(codeBytes, lowBytes.length);
      const lowCode = bytesToCode(lowBytes);
      const highCode = bytesToCode(highBytes);
      const destination = tokens[i];
      if (destination?.type === 'hex') {
        // A single destination starts the range; each following code increments it.
        i += 1;
        for (let code = lowCode; code <= highCode; code += 1) {
          map.set(code, incrementUnicodeHex(destination.value, code - lowCode));
        }
      } else if (destination?.type === 'open') {
        // An array gives one destination per code.
        i += 1;
        let code = lowCode;
        let token = tokens[i];
        while (token?.type === 'hex') {
          map.set(code, hexToUnicode(token.value));
          code += 1;
          i += 1;
          token = tokens[i];
        }
        if (token?.type === 'close') i += 1;
      }
    }
  }

  if (map.size === 0) return null;
  return { codeBytes: Math.max(1, codeBytes), map };
}

/**
 * Resolve PDF literal-string escapes (`\n`, `\(`, `\053`, line continuations)
 * into the raw bytes the string stands for.
 */
function unescapeLiteralString(bytes: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    const code = bytes[i];
    if (code !== 0x5c) {
      out.push(code);
      continue;
    }

    const nextChar = String.fromCharCode(bytes[i + 1] ?? 0);
    const mapped = LITERAL_ESCAPES[nextChar];
    if (mapped !== undefined) {
      out.push(mapped.charCodeAt(0));
      i += 1;
      continue;
    }

    // Octal escape: up to three digits.
    if (nextChar >= '0' && nextChar <= '7') {
      let octal = '';
      let cursor = i + 1;
      while (cursor < bytes.length && octal.length < 3) {
        const digit = String.fromCharCode(bytes[cursor]);
        if (digit < '0' || digit > '7') break;
        octal += digit;
        cursor += 1;
      }
      out.push(parseInt(octal, 8));
      i = cursor - 1;
      continue;
    }

    // Backslash-newline is a line continuation and contributes nothing.
    if (nextChar === '\n') {
      i += 1;
      continue;
    }
    if (nextChar === '\r') {
      i += bytes[i + 2] === 0x0a ? 2 : 1;
      continue;
    }

    // Any other escaped character stands for itself.
    out.push(bytes[i + 1] ?? 0);
    i += 1;
  }
  return out;
}

function looksLikeUtf16Be(bytes: number[]): boolean {
  if (bytes.length < 2 || bytes.length % 2 !== 0) return false;
  let zeroHighBytes = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    if (bytes[i] === 0) zeroHighBytes += 1;
  }
  return zeroHighBytes * 2 >= bytes.length;
}

/**
 * Decode one string operand.
 *
 * With a font map this is exact: each character code is resolved through the
 * font's `/ToUnicode` CMap, and a code the map does not cover makes the operand
 * opaque — we cannot claim to have read text we could not map. Without a map
 * the historical heuristics apply: a hex operand that decodes to printable
 * single-byte text or UTF-16BE is trusted, anything else is opaque.
 */
function decodeOperand(
  bytes: number[],
  kind: 'literal' | 'hex',
  font: ContentStreamFontMap | null,
): PendingString {
  if (font?.toUnicode) {
    const codeBytes = Math.max(1, font.codeBytes);
    if (bytes.length % codeBytes !== 0) {
      return { value: bytesToLatin1(bytes), readable: false };
    }
    let value = '';
    for (let i = 0; i < bytes.length; i += codeBytes) {
      const mapped = font.toUnicode.get(bytesToCode(bytes.slice(i, i + codeBytes)));
      if (mapped === undefined) return { value, readable: false };
      value += mapped;
    }
    return { value, readable: true };
  }

  if (kind === 'hex') {
    if (looksLikeUtf16Be(bytes)) {
      let out = '';
      for (let i = 0; i < bytes.length; i += 2) {
        out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      }
      return { value: out, readable: true };
    }

    // Simple fonts encode one byte per character, and writers (including
    // pdf-lib's own standard-font embedder) routinely emit those as hex.
    // Treating every hex operand as unreadable would make this verifier answer
    // "unknown" for almost every real PDF, which is worse than useless — a
    // verifier that can never confirm removal gives users no signal at all.
    //
    // So: if the bytes decode to printable single-byte text, trust them. Only
    // genuinely non-textual byte patterns — composite/CID glyph indices, which
    // need the font's CMap to resolve — are reported as opaque.
    return { value: bytesToLatin1(bytes), readable: isPrintableSingleByteText(bytes) };
  }

  // A literal string with no font map: the escape-resolved bytes are the best
  // reading available, exactly as before this module learned to read fonts.
  return { value: bytesToLatin1(bytes), readable: true };
}

/**
 * True when the bytes look like text in a single-byte encoding rather than raw
 * glyph indices. Allows Latin-1 printable ranges and common whitespace.
 */
function isPrintableSingleByteText(bytes: number[]): boolean {
  if (bytes.length === 0) return true;
  let printable = 0;
  for (const byte of bytes) {
    const isAsciiPrintable = byte >= 0x20 && byte <= 0x7e;
    const isLatin1Printable = byte >= 0xa0;
    const isWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    if (isAsciiPrintable || isLatin1Printable || isWhitespace) printable += 1;
  }
  // Allow a small amount of noise; require the clear majority to be text.
  return printable / bytes.length >= 0.85;
}

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

/**
 * Pulls the text-showing operands out of a decoded PDF content stream.
 *
 * This is an operand-collecting tokenizer, not a full interpreter: it gathers
 * string operands and flushes them when a text-showing operator appears. That is
 * sufficient to answer "is this text still drawn here", which is all we need.
 *
 * When a page's `fonts` are supplied, the `Tf` operator switches the map each
 * following operand is decoded with — the same font state a real interpreter
 * would track, which is what turns glyph indices back into characters.
 */
export function extractContentStreamText(
  contents: Uint8Array,
  fonts?: ContentStreamFonts,
): ExtractedStreamText {
  let pending: PendingString[] = [];
  const parts: string[] = [];
  let showOperatorCount = 0;
  let sawOpaque = false;
  let currentFont: ContentStreamFontMap | null = null;
  let lastName = '';
  let i = 0;

  while (i < contents.length) {
    const byte = contents[i];

    if (WHITESPACE.has(byte)) {
      i += 1;
      continue;
    }

    // Comment: skip to end of line.
    if (byte === 0x25) {
      while (i < contents.length && contents[i] !== 0x0a && contents[i] !== 0x0d) i += 1;
      continue;
    }

    // Literal string, with balanced-paren nesting.
    if (byte === 0x28) {
      const buf: number[] = [];
      let depth = 1;
      i += 1;
      while (i < contents.length && depth > 0) {
        const c = contents[i];
        if (c === 0x5c) {
          buf.push(c);
          if (i + 1 < contents.length) buf.push(contents[i + 1]);
          i += 2;
          continue;
        }
        if (c === 0x28) depth += 1;
        if (c === 0x29) {
          depth -= 1;
          if (depth === 0) { i += 1; break; }
        }
        buf.push(c);
        i += 1;
      }
      pending.push(decodeOperand(unescapeLiteralString(buf), 'literal', currentFont));
      continue;
    }

    // Hex string, or a dictionary delimiter we can skip.
    if (byte === 0x3c) {
      if (contents[i + 1] === 0x3c) { i += 2; continue; }
      let hex = '';
      i += 1;
      while (i < contents.length && contents[i] !== 0x3e) {
        hex += String.fromCharCode(contents[i]);
        i += 1;
      }
      i += 1;
      pending.push(decodeOperand(hexToBytes(hex), 'hex', currentFont));
      continue;
    }

    if (byte === 0x3e) { i += contents[i + 1] === 0x3e ? 2 : 1; continue; }

    // Array/name/brace delimiters carry no text of their own.
    if (byte === 0x5b || byte === 0x5d || byte === 0x7b || byte === 0x7d) { i += 1; continue; }

    if (byte === 0x2f) {
      i += 1;
      let name = '';
      while (i < contents.length && !WHITESPACE.has(contents[i]) && !DELIMITERS.has(contents[i])) {
        name += String.fromCharCode(contents[i]);
        i += 1;
      }
      // `Tf` selects the font named just before it; remember the last name seen.
      lastName = name;
      continue;
    }

    // Bare token: an operator or a number.
    let token = '';
    while (i < contents.length && !WHITESPACE.has(contents[i]) && !DELIMITERS.has(contents[i])) {
      token += String.fromCharCode(contents[i]);
      i += 1;
    }
    if (!token) { i += 1; continue; }

    if (token === 'Tf') {
      currentFont = fonts?.get(lastName) ?? null;
      pending = [];
      continue;
    }

    if (TEXT_SHOWING_OPERATORS.has(token)) {
      showOperatorCount += 1;
      for (const item of pending) {
        parts.push(item.value);
        if (!item.readable) sawOpaque = true;
      }
      pending = [];
      continue;
    }

    // Numbers are operands (kerning offsets, positions) and are not text.
    if (/^[-+.\d]+$/.test(token)) continue;

    // Any other operator ends the current operand run.
    pending = [];
  }

  return {
    text: parts.join(''),
    confidence: sawOpaque ? 'opaque' : 'readable',
    showOperatorCount,
  };
}

export type PageTextExtraction = {
  page: number;
  status: 'decoded' | 'undecodable' | 'empty';
  text: string;
  confidence: StreamTextConfidence;
  /** Present when the page could not be decoded, explaining why. */
  reason?: string;
};

const TO_UNICODE = PDFName.of('ToUnicode');

/**
 * Build the code → character map for one font dictionary.
 *
 * `/ToUnicode` is the authoritative map for both simple and composite fonts and
 * is the only one this module trusts; its code space also fixes the character
 * code width (2 bytes for Identity-H). A font without one keeps `toUnicode:
 * null`, which makes its operands fall back to the opaque heuristics rather than
 * be mistaken for readable text.
 */
function buildFontMap(pdf: PDFDocument, font: PDFDict): ContentStreamFontMap {
  const subtypeObject = pdf.context.lookup(font.get(PDFName.of('Subtype')));
  const subtype = subtypeObject instanceof PDFName ? subtypeObject.decodeText() : '';
  let codeBytes = subtype === 'Type0' ? 2 : 1;
  let toUnicode: Map<number, string> | null = null;

  const mapStream = pdf.context.lookup(font.get(TO_UNICODE));
  if (mapStream instanceof PDFRawStream) {
    try {
      const parsed = parseToUnicodeCMap(bytesToLatin1(decodePDFRawStream(mapStream).decode()));
      if (parsed) {
        toUnicode = parsed.map;
        codeBytes = parsed.codeBytes;
      }
    } catch {
      // A malformed CMap leaves the font unmapped, so its glyph-index operands
      // stay opaque and are reported as unverified instead of assumed readable.
    }
  }

  return { codeBytes, toUnicode };
}

/** Resolve every font a page can select with `Tf`, keyed by resource name. */
function resolvePageFonts(pdf: PDFDocument, page: ReturnType<PDFDocument['getPages']>[number]): ContentStreamFonts {
  const fonts: ContentStreamFonts = new Map();
  try {
    const resources = page.node.Resources();
    const fontDict = resources ? pdf.context.lookup(resources.get(PDFName.of('Font'))) : undefined;
    if (!(fontDict instanceof PDFDict)) return fonts;
    for (const [key, value] of fontDict.entries()) {
      const font = pdf.context.lookup(value);
      if (font instanceof PDFDict) fonts.set(key.decodeText(), buildFontMap(pdf, font));
    }
  } catch {
    // An unreadable resource tree means no font maps; the caller still gets the
    // per-page decode, and unmappable operands remain opaque.
  }
  return fonts;
}

/**
 * Decodes every page's content streams and returns the text each page draws.
 *
 * A page whose streams cannot be located or inflated yields
 * `status: 'undecodable'`, which callers must treat as "unknown", not "clean".
 */
export async function extractPdfPageText(
  source: ArrayBuffer | Uint8Array,
): Promise<PageTextExtraction[]> {
  let pdf: PDFDocument;
  let pages: ReturnType<PDFDocument['getPages']>;
  try {
    pdf = await PDFDocument.load(source, { updateMetadata: false });
    // pdf-lib resolves the page tree lazily, so a malformed document can load
    // without error and only fail here. Both failures mean the same thing to us:
    // we cannot read this file, so we must not claim anything about its contents.
    pages = pdf.getPages();
  } catch (error) {
    return [{
      page: 1,
      status: 'undecodable',
      text: '',
      confidence: 'opaque',
      reason: `The document could not be parsed: ${(error as Error).message}`,
    }];
  }

  const results: PageTextExtraction[] = [];

  for (let index = 0; index < pages.length; index += 1) {
    const pageNumber = index + 1;
    try {
      const contentsEntry = pages[index].node.get(PDFName.of('Contents'));
      const resolved = contentsEntry ? pdf.context.lookup(contentsEntry) : undefined;

      const streams: PDFRawStream[] = [];
      if (resolved instanceof PDFRawStream) {
        streams.push(resolved);
      } else if (resolved instanceof PDFArray) {
        for (let s = 0; s < resolved.size(); s += 1) {
          const candidate = pdf.context.lookup(resolved.get(s));
          if (candidate instanceof PDFRawStream) streams.push(candidate);
        }
      }

      if (streams.length === 0) {
        results.push({ page: pageNumber, status: 'empty', text: '', confidence: 'readable' });
        continue;
      }

      let text = '';
      let confidence: StreamTextConfidence = 'readable';
      const fonts = resolvePageFonts(pdf, pages[index]);
      for (const stream of streams) {
        const decoded = decodePDFRawStream(stream).decode();
        const extracted = extractContentStreamText(decoded, fonts);
        text += extracted.text;
        if (extracted.confidence === 'opaque') confidence = 'opaque';
      }

      results.push({ page: pageNumber, status: 'decoded', text, confidence });
    } catch (error) {
      results.push({
        page: pageNumber,
        status: 'undecodable',
        text: '',
        confidence: 'opaque',
        reason: `Page ${pageNumber} content could not be decoded: ${(error as Error).message}`,
      });
    }
  }

  return results;
}

/** Text the user asked to have removed, and where it was. */
export type ContentRemovalExpectation = {
  /** Human label for reporting, e.g. "Salary on page 2". */
  label: string;
  /** The exact text that must no longer be drawn. */
  text: string;
  /** 1-based page. Omit to check the whole document. */
  page?: number;
  /**
   * Occurrences still allowed in scope. Default 0 (the text must be absent).
   * A redaction of one repeated run on a page legitimately leaves the other
   * occurrence intact, so absence alone would report a correct removal as a
   * failure.
   */
  maxOccurrences?: number;
};

export type ContentRemovalFindingStatus =
  /** The text is still drawn in the output. The removal did not happen. */
  | 'retained'
  /** The text is provably absent from every page we could decode. */
  | 'removed'
  /** We could not decode enough of the document to make a claim. */
  | 'unverified';

export type ContentRemovalFinding = {
  label: string;
  text: string;
  status: ContentRemovalFindingStatus;
  /** Pages where the text was found still drawn. */
  pages: number[];
  reason?: string;
};

export type ContentRemovalReport = {
  /** Worst finding wins: retained > unverified > clean. */
  status: 'clean' | 'retained' | 'unverified';
  findings: ContentRemovalFinding[];
  pagesInspected: number;
  pagesUndecodable: number[];
  summary: string;
};

function normalizeForComparison(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function countNormalizedOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + Math.max(1, needle.length);
  }
  return count;
}

/**
 * Verifies that text the user removed is actually gone from the exported bytes.
 *
 * Whitespace is normalized before comparison because PDF text operators split
 * words across operands and insert kerning; comparing raw runs would miss
 * retained text and produce a falsely reassuring result.
 */
export async function verifyPdfEditorContentRemoval(
  source: ArrayBuffer | Uint8Array,
  expectations: ContentRemovalExpectation[],
): Promise<ContentRemovalReport> {
  const extractions = await extractPdfPageText(source);
  const undecodable = extractions.filter((entry) => entry.status === 'undecodable');
  const undecodablePages = undecodable.map((entry) => entry.page);

  const findings: ContentRemovalFinding[] = expectations.map((expectation) => {
    const needle = normalizeForComparison(expectation.text);

    if (!needle) {
      return {
        label: expectation.label,
        text: expectation.text,
        status: 'unverified',
        pages: [],
        reason: 'No text was supplied to check, so nothing could be verified.',
      };
    }

    const scope = typeof expectation.page === 'number'
      ? extractions.filter((entry) => entry.page === expectation.page)
      : extractions;

    if (scope.length === 0) {
      return {
        label: expectation.label,
        text: expectation.text,
        status: 'unverified',
        pages: [],
        reason: `Page ${expectation.page} is not present in the exported document.`,
      };
    }

    const allowed = Math.max(0, expectation.maxOccurrences ?? 0);
    const hits = scope
      .filter((entry) => entry.status === 'decoded'
        && countNormalizedOccurrences(normalizeForComparison(entry.text), needle) > allowed)
      .map((entry) => entry.page);

    if (hits.length > 0) {
      return {
        label: expectation.label,
        text: expectation.text,
        status: 'retained',
        pages: hits,
        reason: allowed > 0
          ? `The text is still drawn on page ${hits.join(', ')} more often than the remaining occurrences the edit accounted for.`
          : `The text is still drawn on page ${hits.join(', ')} of the exported file and can be recovered by copying text or running a PDF text extractor.`,
      };
    }

    // Not found — but only claim removal if we could actually read everything.
    const blockers = scope.filter(
      (entry) => entry.status === 'undecodable' || entry.confidence === 'opaque',
    );
    if (blockers.length > 0) {
      const opaque = blockers.some((entry) => entry.confidence === 'opaque' && entry.status === 'decoded');
      return {
        label: expectation.label,
        text: expectation.text,
        status: 'unverified',
        pages: [],
        reason: opaque
          ? `Page ${blockers.map((entry) => entry.page).join(', ')} draws text through an embedded font encoding we cannot map back to characters, so absence could not be confirmed.`
          : `Page ${blockers.map((entry) => entry.page).join(', ')} could not be decoded, so absence could not be confirmed.`,
      };
    }

    return { label: expectation.label, text: expectation.text, status: 'removed', pages: [] };
  });

  const retained = findings.filter((finding) => finding.status === 'retained');
  const unverified = findings.filter((finding) => finding.status === 'unverified');

  const status: ContentRemovalReport['status'] = retained.length > 0
    ? 'retained'
    : unverified.length > 0
      ? 'unverified'
      : 'clean';

  const summary = retained.length > 0
    ? `${retained.length} of ${findings.length} removed item(s) are still present in the exported file.`
    : unverified.length > 0
      ? `${unverified.length} of ${findings.length} removed item(s) could not be verified. Do not treat this export as sanitized.`
      : `All ${findings.length} removed item(s) are absent from the exported file.`;

  return {
    status,
    findings,
    pagesInspected: extractions.length,
    pagesUndecodable: undecodablePages,
    summary,
  };
}

/**
 * True when the report proves removal. Anything else — including "we could not
 * tell" — must block a claim of sanitization.
 */
export function isContentRemovalProven(report: ContentRemovalReport): boolean {
  return report.status === 'clean';
}
