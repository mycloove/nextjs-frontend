/**
 * W2 — vector canvas export.
 *
 * The editor's canvas objects used to leave the document as one raster PNG per
 * page. That kept pixels faithful but turned added text into a picture: not
 * searchable, not selectable, unreadable by a screen reader, and blurry when
 * zoomed. This module decides, page by page, whether the saved Fabric state can
 * be written as real PDF objects.
 *
 * It is deliberately conservative. Latin and Bengali text use embedded fonts
 * (Liberation Sans and Noto Sans Bengali); Bengali is shaped through fontkit, so
 * conjuncts and vowel signs are placed by the font's OpenType rules. Anything
 * this release cannot place faithfully — images, emoji, rotated/flipped objects,
 * groups (arrows), centred or underlined text, right-to-left scripts, italic
 * Bengali (no italic face is embedded), or text the embedded font does not cover
 * — is reported instead of guessed at, and the caller keeps the existing raster
 * overlay for that page. That makes raster a disclosed last resort rather than
 * the default.
 */

import { scriptOfCodePoint } from './editorFontPolicy.ts';
import { bidiReasonForCodePoint } from './editorTextShaping.ts';

export type PdfEditorVectorFontRole =
  | 'latin-regular'
  | 'latin-bold'
  | 'latin-italic'
  | 'latin-boldItalic'
  | 'bengali-regular'
  | 'bengali-bold';

export type PdfEditorVectorFonts = Readonly<Record<PdfEditorVectorFontRole, Uint8Array>>;

/** The subset of faces a single export actually needs. */
export type PdfEditorVectorFontAssets = Partial<Record<PdfEditorVectorFontRole, Uint8Array>>;

/**
 * Coverage is answered by the font actually being embedded, never inferred from
 * the script name: a font that lacks a glyph renders `.notdef` silently.
 */
export type PdfEditorVectorCoverage = (role: PdfEditorVectorFontRole, text: string) => boolean;

const FONT_FAMILY_LABELS: Readonly<Record<PdfEditorVectorFontRole, string>> = {
  'latin-regular': 'Liberation Sans',
  'latin-bold': 'Liberation Sans Bold',
  'latin-italic': 'Liberation Sans Italic',
  'latin-boldItalic': 'Liberation Sans Bold Italic',
  'bengali-regular': 'Noto Sans Bengali',
  'bengali-bold': 'Noto Sans Bengali Bold',
};

export function vectorFontFamilyLabel(role: PdfEditorVectorFontRole): string {
  return FONT_FAMILY_LABELS[role];
}

/** A resolved PDF paint. `null` means "no paint on this channel". */
export type PdfEditorVectorPaint = {
  color: readonly [number, number, number];
  opacity: number;
};

type VectorBase = {
  page: number;
  opacity: number;
};

export type PdfEditorVectorOperation =
  | (VectorBase & {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      size: number;
      font: PdfEditorVectorFontRole;
      color: PdfEditorVectorPaint;
      maxWidth: number;
      lineHeight: number;
    })
  | (VectorBase & {
      kind: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      fill: PdfEditorVectorPaint | null;
      stroke: PdfEditorVectorPaint | null;
      strokeWidth: number;
    })
  | (VectorBase & {
      kind: 'ellipse';
      x: number;
      y: number;
      rx: number;
      ry: number;
      fill: PdfEditorVectorPaint | null;
      stroke: PdfEditorVectorPaint | null;
      strokeWidth: number;
    })
  | (VectorBase & {
      kind: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke: PdfEditorVectorPaint;
      strokeWidth: number;
    })
  | (VectorBase & {
      kind: 'polyline';
      points: ReadonlyArray<{ x: number; y: number }>;
      stroke: PdfEditorVectorPaint;
      strokeWidth: number;
    });

export type PdfEditorVectorPagePlan =
  | { ok: true; operations: PdfEditorVectorOperation[]; hasText: boolean; reasons: [] }
  | { ok: false; operations: []; hasText: false; reasons: string[] };

export type PdfEditorVectorPageInput = {
  page: number;
  /** Page box in PDF points, in the same space as the Fabric canvas. */
  width: number;
  height: number;
  state: unknown;
};

type FabricObject = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const str = (value: unknown): string => typeof value === 'string' ? value : '';

const bool = (value: unknown): boolean => value === true;

const near = (left: number, right: number) => Math.abs(left - right) < 0.001;

/** Fabric stores either a command string or an array of 0-1 normalized values. */
const colorComponent = (raw: string, scale: number): number => {
  const value = raw.trim();
  if (value.endsWith('%')) return Math.max(0, Math.min(255, Number.parseFloat(value) / 100 * 255));
  const parsed = Number.parseFloat(value);
  return Math.max(0, Math.min(255, Number.isFinite(parsed) ? parsed * scale : 0));
};

/**
 * CSS colours the canvas can produce. Anything else is reported rather than
 * silently rendered black — a wrong colour is worse than a known raster page.
 */
export function parsePdfEditorVectorColor(value: unknown): { color: [number, number, number]; opacity: number } | null {
  if (typeof value !== 'string') return null;
  const input = value.trim().toLowerCase();
  if (!input || input === 'transparent' || input === 'none') return null;

  if (input.startsWith('#')) {
    const hex = input.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const channels = [...hex].map(char => Number.parseInt(char + char, 16));
      if (channels.some(Number.isNaN)) return null;
      const [r, g, b, a = 255] = channels;
      return { color: [r / 255, g / 255, b / 255], opacity: a / 255 };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255;
      if ([r, g, b, a].some(Number.isNaN)) return null;
      return { color: [r / 255, g / 255, b / 255], opacity: a / 255 };
    }
    return null;
  }

  const fn = /^rgba?\((.*)\)$/.exec(input);
  if (fn) {
    const parts = fn[1].split(',').map(part => part.trim());
    if (parts.length < 3 || parts.length > 4) return null;
    const r = colorComponent(parts[0], 1);
    const g = colorComponent(parts[1], 1);
    const b = colorComponent(parts[2], 1);
    const alphaRaw = parts[3];
    const a = alphaRaw === undefined
      ? 1
      : alphaRaw.endsWith('%')
        ? Number.parseFloat(alphaRaw) / 100
        : Number.parseFloat(alphaRaw);
    if ([r, g, b, a].some(Number.isNaN)) return null;
    return { color: [r / 255, g / 255, b / 255], opacity: Math.max(0, Math.min(1, a)) };
  }

  const named: Record<string, [number, number, number]> = {
    black: [0, 0, 0],
    white: [1, 1, 1],
    red: [1, 0, 0],
    green: [0, 0.5, 0],
    blue: [0, 0, 1],
    yellow: [1, 1, 0],
    orange: [1, 0.647, 0],
    gray: [0.5, 0.5, 0.5],
    grey: [0.5, 0.5, 0.5],
  };
  const rgb = named[input];
  return rgb ? { color: rgb, opacity: 1 } : null;
}

const isBengaliText = (text: string): boolean => /[\u0980-\u09ff]/.test(text);

/**
 * Bidi is checked before fonts: a font can cover Arabic or Hebrew glyphs, but
 * nothing in this stack orders mixed left-to-right and right-to-left runs.
 */
const bidiBlocker = (text: string): string | null => {
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (bidiReasonForCodePoint(codePoint)) {
      return `${scriptOfCodePoint(codePoint) ?? 'right-to-left'} text that needs bidirectional reordering`;
    }
  }
  return null;
};

const isRotatedOrFlipped = (object: FabricObject): boolean => {
  const angle = num(object.angle, 0) % 360;
  return Math.abs(angle) > 0.001 || bool(object.flipX) || bool(object.flipY);
};

const paint = (value: unknown, objectOpacity: number): PdfEditorVectorPaint | null => {
  const parsed = parsePdfEditorVectorColor(value);
  if (!parsed) return null;
  return { color: parsed.color, opacity: parsed.opacity * Math.max(0, Math.min(1, objectOpacity)) };
};

const topLeft = (object: FabricObject) => {
  // Fabric defaults are left/top origins. A centre origin changes every
  // coordinate, so treat it as unsupported rather than shifting the object.
  const originX = str(object.originX) || 'left';
  const originY = str(object.originY) || 'top';
  return originX === 'left' && originY === 'top';
};

const scale = (object: FabricObject) => {
  const scaleX = num(object.scaleX, 1);
  const scaleY = num(object.scaleY, 1);
  return { scaleX, scaleY, uniform: near(Math.abs(scaleX), Math.abs(scaleY)) };
};

const unsupported = (reasons: Set<string>, reason: string) => { reasons.add(reason); };

function textOperation(
  object: FabricObject,
  page: number,
  pageHeight: number,
  reasons: Set<string>,
  coverage?: PdfEditorVectorCoverage,
): PdfEditorVectorOperation | null {
  if (!topLeft(object)) { unsupported(reasons, 'text with a non-top-left origin'); return null; }
  if (isRotatedOrFlipped(object)) { unsupported(reasons, 'rotated or flipped text'); return null; }
  const geometry = scale(object);
  if (!geometry.uniform) { unsupported(reasons, 'stretched text'); return null; }
  if (str(object.textAlign) && str(object.textAlign) !== 'left') {
    unsupported(reasons, 'centred or right-aligned text');
    return null;
  }
  if (bool(object.underline)) { unsupported(reasons, 'underlined text'); return null; }
  const background = str(object.backgroundColor);
  if (background && background !== 'transparent') { unsupported(reasons, 'text with a background fill'); return null; }

  const text = str(object.text).replace(/\r\n?/g, '\n');
  if (!text.trim()) return null;
  const bidi = bidiBlocker(text);
  if (bidi) { unsupported(reasons, bidi); return null; }

  const color = paint(object.fill, num(object.opacity, 1));
  if (!color) { unsupported(reasons, 'text with an unsupported colour'); return null; }

  const size = num(object.fontSize, 16) * Math.abs(geometry.scaleY);
  if (size < 1) { unsupported(reasons, 'text smaller than one point'); return null; }
  const width = Math.max(1, num(object.width, 0) * Math.abs(geometry.scaleX));
  const fontWeight = object.fontWeight;
  const bold = fontWeight === 'bold'
    || (typeof fontWeight === 'number' && fontWeight >= 600)
    || (typeof fontWeight === 'string' && Number.parseInt(fontWeight, 10) >= 600);
  const italic = str(object.fontStyle) === 'italic' || str(object.fontStyle) === 'oblique';
  const bengali = isBengaliText(text);
  if (bengali && italic) {
    unsupported(reasons, 'italic Bengali text (the embedded Bengali face has no italic)');
    return null;
  }
  const font: PdfEditorVectorFontRole = bengali
    ? bold ? 'bengali-bold' : 'bengali-regular'
    : bold && italic ? 'latin-boldItalic' : bold ? 'latin-bold' : italic ? 'latin-italic' : 'latin-regular';
  if (coverage && !coverage(font, text)) {
    unsupported(reasons, `text the embedded ${vectorFontFamilyLabel(font)} font does not cover`);
    return null;
  }

  return {
    kind: 'text',
    page,
    opacity: 1,
    x: num(object.left, 0) * geometry.scaleX,
    // Fabric's top is the line box top; the PDF baseline sits about one
    // font-size below it. This is the same approximation the text editor uses.
    y: pageHeight - num(object.top, 0) * geometry.scaleY - size,
    text,
    size,
    font,
    color,
    maxWidth: width,
    lineHeight: Math.max(0.5, num(object.lineHeight, 1.16)),
  };
}

function rectOperation(
  object: FabricObject,
  page: number,
  pageHeight: number,
  reasons: Set<string>,
): PdfEditorVectorOperation | null {
  if (!topLeft(object)) { unsupported(reasons, 'shape with a non-top-left origin'); return null; }
  if (isRotatedOrFlipped(object)) { unsupported(reasons, 'rotated or flipped shape'); return null; }
  const geometry = scale(object);
  if (!geometry.uniform) { unsupported(reasons, 'stretched shape'); return null; }
  if (num(object.rx, 0) > 0 || num(object.ry, 0) > 0) { unsupported(reasons, 'rounded rectangle'); return null; }

  const width = num(object.width, 0) * Math.abs(geometry.scaleX);
  const height = num(object.height, 0) * Math.abs(geometry.scaleY);
  if (width <= 0 || height <= 0) return null;
  const opacity = num(object.opacity, 1);
  const fill = paint(object.fill, opacity);
  const stroke = paint(object.stroke, opacity);
  if (!fill && !stroke) return null;
  const strokeWidth = Math.max(0, num(object.strokeWidth, 0) * Math.abs(geometry.scaleX));

  return {
    kind: 'rect',
    page,
    opacity: 1,
    x: num(object.left, 0) * geometry.scaleX,
    y: pageHeight - num(object.top, 0) * geometry.scaleY - height,
    width,
    height,
    fill,
    stroke,
    strokeWidth,
  };
}

function ellipseOperation(
  object: FabricObject,
  page: number,
  pageHeight: number,
  reasons: Set<string>,
): PdfEditorVectorOperation | null {
  if (!topLeft(object)) { unsupported(reasons, 'ellipse with a non-top-left origin'); return null; }
  if (isRotatedOrFlipped(object)) { unsupported(reasons, 'rotated or flipped ellipse'); return null; }
  const geometry = scale(object);
  if (!geometry.uniform) { unsupported(reasons, 'stretched ellipse'); return null; }

  const rx = num(object.rx, 0) * Math.abs(geometry.scaleX);
  const ry = num(object.ry, 0) * Math.abs(geometry.scaleY);
  if (rx <= 0 || ry <= 0) return null;
  const opacity = num(object.opacity, 1);
  const fill = paint(object.fill, opacity);
  const stroke = paint(object.stroke, opacity);
  if (!fill && !stroke) return null;

  return {
    kind: 'ellipse',
    page,
    opacity: 1,
    x: num(object.left, 0) * geometry.scaleX + rx,
    y: pageHeight - num(object.top, 0) * geometry.scaleY - ry,
    rx,
    ry,
    fill,
    stroke,
    strokeWidth: Math.max(0, num(object.strokeWidth, 0) * Math.abs(geometry.scaleX)),
  };
}

function lineOperation(
  object: FabricObject,
  page: number,
  pageHeight: number,
  reasons: Set<string>,
): PdfEditorVectorOperation | null {
  if (!topLeft(object)) { unsupported(reasons, 'line with a non-top-left origin'); return null; }
  if (isRotatedOrFlipped(object)) { unsupported(reasons, 'rotated or flipped line'); return null; }
  const geometry = scale(object);
  const opacity = num(object.opacity, 1);
  const stroke = paint(object.stroke, opacity);
  if (!stroke) { unsupported(reasons, 'line without a supported colour'); return null; }
  const left = num(object.left, 0) * geometry.scaleX;
  const top = num(object.top, 0) * geometry.scaleY;
  return {
    kind: 'line',
    page,
    opacity: 1,
    x1: left + num(object.x1, 0) * geometry.scaleX,
    y1: pageHeight - (top + num(object.y1, 0) * geometry.scaleY),
    x2: left + num(object.x2, 0) * geometry.scaleX,
    y2: pageHeight - (top + num(object.y2, 0) * geometry.scaleY),
    stroke,
    strokeWidth: Math.max(0.1, num(object.strokeWidth, 1) * Math.abs(geometry.scaleX)),
  };
}

type Point = { x: number; y: number };

const collectPathPolylines = (object: FabricObject): Point[][] | null => {
  const commands = object.path;
  if (!Array.isArray(commands)) return null;
  const left = num(object.left, 0);
  const top = num(object.top, 0);
  const geometry = scale(object);
  const polylines: Point[][] = [];
  let current: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  const map = (x: number, y: number): Point => ({
    x: (left + x) * geometry.scaleX,
    y: top + y * geometry.scaleY,
  });

  const push = (x: number, y: number) => {
    cursor = map(x, y);
    current.push(cursor);
  };

  for (const command of commands) {
    if (!Array.isArray(command) || typeof command[0] !== 'string') return null;
    const op = command[0].toUpperCase();
    const values = command.slice(1).map(value => Number(value));
    if (values.some(value => !Number.isFinite(value))) return null;

    if (op === 'M') {
      if (current.length > 1) polylines.push(current);
      current = [];
      push(values[0], values[1]);
      start = cursor;
      continue;
    }
    if (op === 'Z') {
      if (current.length > 0) current.push(start);
      continue;
    }
    if (current.length === 0) return null;

    if (op === 'L') {
      push(values[0], values[1]);
    } else if (op === 'Q') {
      const [cx, cy, x, y] = values;
      const from = cursor;
      for (let step = 1; step <= 10; step += 1) {
        const t = step / 10;
        const inverse = 1 - t;
        const px = inverse * inverse * (from.x / geometry.scaleX - left)
          + 2 * inverse * t * cx
          + t * t * x;
        const py = inverse * inverse * (from.y / geometry.scaleY - top)
          + 2 * inverse * t * cy
          + t * t * y;
        push(px, py);
      }
    } else if (op === 'C') {
      const [c1x, c1y, c2x, c2y, x, y] = values;
      const fromX = cursor.x / geometry.scaleX - left;
      const fromY = cursor.y / geometry.scaleY - top;
      for (let step = 1; step <= 12; step += 1) {
        const t = step / 12;
        const inverse = 1 - t;
        const px = inverse ** 3 * fromX
          + 3 * inverse * inverse * t * c1x
          + 3 * inverse * t * t * c2x
          + t ** 3 * x;
        const py = inverse ** 3 * fromY
          + 3 * inverse * inverse * t * c1y
          + 3 * inverse * t * t * c2y
          + t ** 3 * y;
        push(px, py);
      }
    } else {
      return null;
    }
  }
  if (current.length > 1) polylines.push(current);
  return polylines;
};

function pathOperations(
  object: FabricObject,
  page: number,
  pageHeight: number,
  reasons: Set<string>,
): PdfEditorVectorOperation[] {
  if (!topLeft(object)) { unsupported(reasons, 'drawing with a non-top-left origin'); return []; }
  if (isRotatedOrFlipped(object)) { unsupported(reasons, 'rotated or flipped drawing'); return []; }
  const geometry = scale(object);
  if (!geometry.uniform) { unsupported(reasons, 'stretched drawing'); return []; }
  if (Math.abs(geometry.scaleX) < 0.001) { unsupported(reasons, 'zero-scale drawing'); return []; }
  const fill = paint(object.fill, num(object.opacity, 1));
  if (fill) { unsupported(reasons, 'filled freehand drawing'); return []; }
  const stroke = paint(object.stroke, num(object.opacity, 1));
  if (!stroke) { unsupported(reasons, 'freehand drawing without a supported colour'); return []; }
  const polylines = collectPathPolylines(object);
  if (!polylines || polylines.length === 0) { unsupported(reasons, 'unsupported freehand path'); return []; }
  const strokeWidth = Math.max(0.1, num(object.strokeWidth, 1) * Math.abs(geometry.scaleX));
  return polylines
    .filter(points => points.length > 1)
    .map(points => ({
      kind: 'polyline' as const,
      page,
      opacity: 1,
      points: points.map(point => ({ x: point.x, y: pageHeight - point.y })),
      stroke,
      strokeWidth,
    }));
}

function planObject(
  object: FabricObject,
  page: number,
  pageHeight: number,
  reasons: Set<string>,
  coverage?: PdfEditorVectorCoverage,
): PdfEditorVectorOperation[] {
  if (object.visible === false) return [];
  const type = str(object.type);
  switch (type) {
    case 'textbox':
    case 'i-text':
    case 'text': {
      const operation = textOperation(object, page, pageHeight, reasons, coverage);
      return operation ? [operation] : [];
    }
    case 'rect': {
      const operation = rectOperation(object, page, pageHeight, reasons);
      return operation ? [operation] : [];
    }
    case 'ellipse':
    case 'circle': {
      const operation = ellipseOperation(object, page, pageHeight, reasons);
      return operation ? [operation] : [];
    }
    case 'line': {
      const operation = lineOperation(object, page, pageHeight, reasons);
      return operation ? [operation] : [];
    }
    case 'path': {
      return pathOperations(object, page, pageHeight, reasons);
    }
    case 'image':
      unsupported(reasons, 'image');
      return [];
    case 'group':
      unsupported(reasons, 'grouped object (for example an arrow)');
      return [];
    default:
      unsupported(reasons, type ? `${type} object` : 'unrecognised object');
      return [];
  }
}

/**
 * Classify one page. A page is vector-safe only when every visible object is
 * placeable; one unsupported object sends the whole page to the disclosed raster
 * fallback. That is stricter than mixing a PNG and vectors in an unknown order,
 * and it means the page's appearance cannot silently change.
 */
export function planPdfEditorVectorPage(
  input: PdfEditorVectorPageInput,
  coverage?: PdfEditorVectorCoverage,
): PdfEditorVectorPagePlan {
  const state = input.state;
  const objects = isRecord(state) && Array.isArray(state.objects) ? state.objects : [];
  const reasons = new Set<string>();
  const operations: PdfEditorVectorOperation[] = [];

  for (const object of objects) {
    if (!isRecord(object)) { unsupported(reasons, 'unreadable canvas object'); continue; }
    operations.push(...planObject(object, input.page, input.height, reasons, coverage));
  }

  if (reasons.size > 0) {
    return { ok: false, operations: [], hasText: false, reasons: [...reasons].sort() };
  }
  return {
    ok: true,
    operations,
    hasText: operations.some(operation => operation.kind === 'text'),
    reasons: [],
  };
}
