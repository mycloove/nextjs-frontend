// `@pdf-lib/fontkit` references this as a global from inside its transpiled
// bundles. The import must precede fontkit, and the editor's shaped-script path
// (Bengali) needs it even when only Latin text happens to be exported.
import 'regenerator-runtime/runtime.js';

import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  assessTextRendering,
  decideTextRenderingRoute,
  describeTextRenderingRequirement,
} from './editorTextShaping.ts';
import {
  isPdfEditorFeatureEnabled,
  type PdfEditorFeatureFlagState,
} from './editorFeatureFlags.ts';
import type {
  PdfEditorVectorFontAssets,
  PdfEditorVectorFontRole,
  PdfEditorVectorOperation,
} from './editorVectorOverlay.ts';


import type {
  PDFContext,
  PDFFont,
  PDFImage,
  PDFPage,
} from 'pdf-lib';

export type PdfEditorExportMode =
  | 'byte-preserving'
  | 'structure-preserving'
  | 'compatibility-render';

export type PdfEditorExportDecision = {
  mode: PdfEditorExportMode;
  preservation: 'exact' | 'source-structure' | 'visual-and-searchable';
  reason: string;
};

/**
 * Page-size presets the editor offers. Declared here rather than in
 * `usePdfEditor.ts` so the export decision can be typed against the real set of
 * values instead of a bare `string` — see {@link PdfEditorExportPageSize}.
 */
export type PdfEditorPageSizeKey =
  | 'original'
  | 'a4'
  | 'a3'
  | 'a2'
  | 'letter'
  | 'legal';

/**
 * What `decidePdfEditorExportMode` may be asked about.
 *
 * `compatibility-fallback` is not a page size. It is a sentinel the export path
 * passes after a structure-preserving attempt fails, to force the decision away
 * from `byte-preserving`. It is spelled out in the type because it used to
 * typecheck only by accident: `pageSize` was a loose `string`, so the sentinel
 * silently sidestepped the `=== 'original'` branch with nothing recording that
 * this was deliberate. A future rename of the branch would have broken it
 * silently. (C9)
 */
export type PdfEditorExportPageSize =
  | PdfEditorPageSizeKey
  | 'compatibility-fallback';

export type PdfEditorExportState = {
  pageSize: PdfEditorExportPageSize;
  hasTextEdits: boolean;
  hasCanvasObjects: boolean;
  hasMutationsOnRotatedPages?: boolean;
};

export type PdfEditorTextMutation = PdfEditorTextAppearance & {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  sourceFontSize: number;
  /**
   * The colour the editor seeded `color` with when the block was first read.
   *
   * Optional because it is frequently unknowable: PDF.js `getTextContent()`
   * reports no fill colour, so the editor falls back to a placeholder. Carrying
   * the seed lets the server client tell "the user picked this colour" apart
   * from "nobody ever chose one", which is the difference between honouring a
   * choice and silently repainting blue text black. See
   * `UNKNOWN_SOURCE_TEXT_COLOR` in `editorServerTextEdit.ts`.
   */
  sourceColor?: string;
  /**
   * W3: this mutation is a redaction, not a rewrite. The server uses it to
   * erase identifying metadata in addition to removing the source glyphs.
   * Explicit because an ordinary edit that deletes a line must keep the
   * document's authorship metadata.
   */
  redact?: boolean;
};

export type PdfEditorOverlayMutation = {
  page: number;
  pngBytes: ArrayBuffer | Uint8Array;
  width: number;
  height: number;
  x?: number;
  y?: number;
  opacity?: number;
};

export type StructurePreservingExportInput = {
  /**
   * Feature flags for this export. Passed in rather than read from the
   * environment so a test can exercise both the guarded and legacy paths, and
   * so one export cannot change behaviour halfway through.
   */
  flags?: PdfEditorFeatureFlagState;
  source: ArrayBuffer | Uint8Array;

  textMutations?: PdfEditorTextMutation[];
  overlayMutations?: PdfEditorOverlayMutation[];
  /**
   * W2: real text/shape/freehand objects. A page sent here must contain no
   * unsupported objects; the caller keeps those pages on `overlayMutations`.
   */
  vectorMutations?: PdfEditorVectorOperation[];
  /**
   * Required for every font role referenced by a text operation. Partial
   * because an export that writes only shapes needs no fonts, and a document
   * with only Latin text should not download the Bengali faces.
   */
  vectorFonts?: PdfEditorVectorFontAssets;
};

export type PdfEditorTextAppearance = {
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  backgroundColor?: string;
};

export type PdfEditorSourceText = {
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
};

export function decidePdfEditorExportMode(state: PdfEditorExportState): PdfEditorExportDecision {
  if (state.pageSize === 'original' && !state.hasTextEdits && !state.hasCanvasObjects) {
    return {
      mode: 'byte-preserving',
      preservation: 'exact',
      reason: 'The document has no effective editor mutations.',
    };
  }

  if (state.pageSize === 'original' && !state.hasMutationsOnRotatedPages) {
    return {
      mode: 'structure-preserving',
      preservation: 'source-structure',
      reason: 'Original-size edits can be appended to the source PDF without rebuilding its pages.',
    };
  }

  return {
    mode: 'compatibility-render',
    preservation: 'visual-and-searchable',
    reason: 'At least one edit or page-size transformation requires the compatibility renderer.',
  };
}

const PDF_TEXT_CHAR_FALLBACKS: Record<string, string> = {
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

export function makeStandardFontSafeText(text: string, font: Pick<PDFFont, 'encodeText'>): string {
  return Array.from(text)
    .map((char) => {
      const candidate = PDF_TEXT_CHAR_FALLBACKS[char] ?? char;
      if (candidate === '\r' || candidate === '\n' || candidate === '\t') return ' ';
      try {
        font.encodeText(candidate);
        return candidate;
      } catch {
        return '?';
      }
    })
    .join('');
}

export function wrapPdfEditorText(
  text: string,
  font: Pick<PDFFont, 'widthOfTextAtSize'>,
  fontSize: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];

  text.split(/\r?\n/).forEach((hardLine) => {
    const words = hardLine.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      return;
    }

    let line = words[0];
    words.slice(1).forEach((word) => {
      const next = `${line} ${word}`;
      if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
    });
    lines.push(line);
  });

  return lines;
}

function hexToRgb01(hex: string) {
  const clean = hex.replace('#', '').trim();
  if (!/^[0-9a-f]{6}$/i.test(clean)) return { r: 0.07, g: 0.07, b: 0.07 };
  return {
    r: parseInt(clean.slice(0, 2), 16) / 255,
    g: parseInt(clean.slice(2, 4), 16) / 255,
    b: parseInt(clean.slice(4, 6), 16) / 255,
  };
}

function pickStandardFont(
  mutation: PdfEditorTextMutation,
  fonts: {
    regular: PDFFont;
    bold: PDFFont;
    italic: PDFFont;
    boldItalic: PDFFont;
  },
) {
  if (mutation.bold && mutation.italic) return fonts.boldItalic;
  if (mutation.bold) return fonts.bold;
  if (mutation.italic) return fonts.italic;
  return fonts.regular;
}

function drawTextMutation(
  page: PDFPage,
  mutation: PdfEditorTextMutation,
  fonts: {
    regular: PDFFont;
    bold: PDFFont;
    italic: PDFFont;
    boldItalic: PDFFont;
  },
) {
  const cropBox = page.getCropBox();
  const font = pickStandardFont(mutation, fonts);
  const padX = Math.max(2, mutation.sourceFontSize * 0.18);
  const padY = Math.max(2, mutation.sourceFontSize * 0.24);
  const x = cropBox.x + mutation.x - padX;
  const yTop = mutation.y - padY;
  const width = mutation.width + padX * 2;
  const fontSize = Math.max(6, mutation.fontSize);
  const lineHeight = Math.max(fontSize, fontSize * mutation.lineHeight);
  const maxWidth = Math.max(10, mutation.width);
  const safeText = makeStandardFontSafeText(mutation.text, font);
  const lines = wrapPdfEditorText(safeText, font, fontSize, maxWidth);
  const height = Math.max(
    mutation.height + padY * 2,
    lines.length * lineHeight + padY * 2,
  );
  const rectangleY = cropBox.y + cropBox.height - yTop - height;
  const background = mutation.backgroundColor && mutation.backgroundColor !== 'transparent'
    ? hexToRgb01(mutation.backgroundColor)
    : { r: 1, g: 1, b: 1 };

  page.drawRectangle({
    x,
    y: rectangleY,
    width,
    height,
    color: rgb(background.r, background.g, background.b),
  });

  const foreground = hexToRgb01(mutation.color);
  lines.forEach((line, lineIndex) => {
    const lineWidth = font.widthOfTextAtSize(line, fontSize);
    const textX = mutation.align === 'center'
      ? x + padX + (maxWidth - lineWidth) / 2
      : mutation.align === 'right'
        ? x + padX + maxWidth - lineWidth
        : x + padX;
    const textTop = yTop + padY * 0.55 + lineIndex * lineHeight;
    const textY = cropBox.y + cropBox.height - textTop - fontSize;

    page.drawText(line, {
      x: textX,
      y: textY,
      size: fontSize,
      font,
      color: rgb(foreground.r, foreground.g, foreground.b),
      maxWidth,
    });

    if (mutation.underline) {
      page.drawRectangle({
        x: textX,
        y: textY - Math.max(1, fontSize * 0.16),
        width: lineWidth,
        height: Math.max(0.5, fontSize * 0.06),
        color: rgb(foreground.r, foreground.g, foreground.b),
      });
    }
  });
}

function drawOverlayMutation(
  page: PDFPage,
  overlay: PdfEditorOverlayMutation,
  image: PDFImage,
) {
  const cropBox = page.getCropBox();
  page.drawImage(image, {
    x: cropBox.x + (overlay.x ?? 0),
    y: cropBox.y + (overlay.y ?? 0),
    width: overlay.width,
    height: overlay.height,
    opacity: overlay.opacity ?? 1,
  });
}

export type UnrenderableTextMutation = {
  /** 1-based page number the refused edit belongs to. */
  page: number;
  /** Index within the supplied `textMutations` array. */
  mutationIndex: number;
  /** Sentence naming the script and stating that the edit was not applied. */
  message: string;
};

/**
 * W2 — find text edits that `drawText` cannot lay out correctly.
 *
 * Exported and pure so the refusal can be asserted without building a PDF, and
 * so the UI can show the same sentences the export would refuse with.
 *
 * Only `refuse-unsupported-script` is collected. `embed-unicode-font` is not a
 * failure: Cyrillic, Greek and CJK place one glyph per code point, so they
 * render correctly once a font covering them is embedded. Refusing those too
 * would block text this renderer can honestly draw.
 */
export function findUnrenderableTextMutations(
  textMutations: readonly PdfEditorTextMutation[],
): UnrenderableTextMutation[] {
  const refused: UnrenderableTextMutation[] = [];

  textMutations.forEach((mutation, mutationIndex) => {
    const requirement = assessTextRendering(mutation.text);
    if (decideTextRenderingRoute(requirement) !== 'refuse-unsupported-script') return;
    refused.push({
      page: mutation.page,
      mutationIndex,
      message: describeTextRenderingRequirement(requirement),
    });
  });

  return refused;
}

/**
 * Thrown instead of writing text the renderer would mangle. Carries the per-edit
 * detail so the caller can point at the offending field rather than showing a
 * generic failure.
 */
export class UnsupportedScriptExportError extends Error {
  readonly refusals: UnrenderableTextMutation[];

  constructor(refusals: UnrenderableTextMutation[]) {
    const pages = [...new Set(refusals.map((refusal) => refusal.page))].sort((a, b) => a - b);
    super(
      `Export refused: ${refusals.length} text edit(s) on page(s) ${pages.join(', ')} use a script this editor cannot lay out correctly. `
      + refusals.map((refusal) => refusal.message).join(' '),
    );
    this.name = 'UnsupportedScriptExportError';
    this.refusals = refusals;
  }
}

export async function exportStructurePreservingPdf(
  input: StructurePreservingExportInput,

): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input.source, {
    updateMetadata: false,
    throwOnInvalidObject: true,
  });
  const pages = pdf.getPages();
  const textMutations = input.textMutations ?? [];
  const overlayMutations = input.overlayMutations ?? [];
  const vectorMutations = input.vectorMutations ?? [];

  for (const mutation of [...textMutations, ...overlayMutations, ...vectorMutations]) {
    if (!Number.isInteger(mutation.page) || mutation.page < 1 || mutation.page > pages.length) {
      throw new Error(`Export mutation references invalid page ${mutation.page}.`);
    }
    if (pages[mutation.page - 1].getRotation().angle % 360 !== 0) {
      throw new Error(`Structure-preserving export does not yet support edited rotated page ${mutation.page}.`);
    }
  }

  /**
   * Refuse before embedding fonts or drawing anything. `pdf.save()` is never
   * reached for a refused document, so there is no partially-written file to
   * clean up and no chance of a caller shipping mangled text.
   */
  if (isPdfEditorFeatureEnabled('textShapingGuard', input.flags)) {
    const refusals = findUnrenderableTextMutations(textMutations);
    if (refusals.length > 0) throw new UnsupportedScriptExportError(refusals);
  }

  const fonts = textMutations.length > 0

    ? {
        regular: await pdf.embedFont(StandardFonts.Helvetica),
        bold: await pdf.embedFont(StandardFonts.HelveticaBold),
        italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
        boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
      }
    : null;

  if (fonts) {
    textMutations.forEach((mutation) => {
      drawTextMutation(pages[mutation.page - 1], mutation, fonts);
    });
  }

  for (const overlay of overlayMutations) {
    const image = await pdf.embedPng(overlay.pngBytes);
    drawOverlayMutation(pages[overlay.page - 1], overlay, image);
  }

  if (vectorMutations.length > 0) {
    const textRoles = [...new Set(vectorMutations.flatMap(operation =>
      operation.kind === 'text' ? [operation.font] : []))];
    const vectorFonts: Partial<Record<PdfEditorVectorFontRole, PDFFont>> = {};
    if (textRoles.length > 0) {
      pdf.registerFontkit(fontkit);
      for (const role of textRoles) {
        const bytes = input.vectorFonts?.[role];
        if (!bytes) {
          throw new Error(`Embedded export font ${role} is unavailable, so vector text cannot be written.`);
        }
        vectorFonts[role] = await pdf.embedFont(bytes, { subset: true });
      }
    }
    for (const operation of vectorMutations) {
      drawVectorOperation(pages[operation.page - 1], operation, vectorFonts, pdf.context);
    }
  }

  return pdf.save({
    addDefaultPage: false,
    updateFieldAppearances: false,
  });
}

function drawVectorOperation(
  page: PDFPage,
  operation: PdfEditorVectorOperation,
  fonts: Partial<Record<PdfEditorVectorFontRole, PDFFont>>,
  context: PDFContext,
) {
  const colorOf = (paint: { color: readonly [number, number, number] }) =>
    rgb(paint.color[0], paint.color[1], paint.color[2]);

  switch (operation.kind) {
    case 'text': {
      const font = fonts[operation.font];
      if (!font) throw new Error(`Vector text was planned without the embedded ${operation.font} font.`);
      // Shaping reorders glyphs (a Bengali vowel sign is drawn before its
      // consonant). `/ActualText` preserves the authored string for viewers
      // that implement marked content, so copy/paste is not visual-order only.
      // pdf-lib's operator-argument type omits PDFDict even though `BDC` takes
      // one; the object form is the documented marked-content property list.
      const properties = context.obj({
        ActualText: PDFHexString.fromText(operation.text),
      }) as unknown as NonNullable<Parameters<typeof PDFOperator.of>[1]>[number];
      page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
        PDFName.of('Span'),
        properties,
      ]));
      page.drawText(operation.text, {
        x: operation.x,
        y: operation.y,
        size: operation.size,
        font,
        color: colorOf(operation.color),
        opacity: operation.color.opacity,
        maxWidth: operation.maxWidth,
        lineHeight: operation.size * operation.lineHeight,
      });
      page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
      break;
    }
    case 'rect':
      page.drawRectangle({
        x: operation.x,
        y: operation.y,
        width: operation.width,
        height: operation.height,
        ...(operation.fill ? { color: colorOf(operation.fill), opacity: operation.fill.opacity } : {}),
        ...(operation.stroke
          ? {
              borderColor: colorOf(operation.stroke),
              borderOpacity: operation.stroke.opacity,
              borderWidth: operation.strokeWidth,
            }
          : {}),
      });
      break;
    case 'ellipse':
      page.drawEllipse({
        x: operation.x,
        y: operation.y,
        xScale: operation.rx,
        yScale: operation.ry,
        ...(operation.fill ? { color: colorOf(operation.fill), opacity: operation.fill.opacity } : {}),
        ...(operation.stroke
          ? {
              borderColor: colorOf(operation.stroke),
              borderOpacity: operation.stroke.opacity,
              borderWidth: operation.strokeWidth,
            }
          : {}),
      });
      break;
    case 'line':
      page.drawLine({
        start: { x: operation.x1, y: operation.y1 },
        end: { x: operation.x2, y: operation.y2 },
        thickness: operation.strokeWidth,
        color: colorOf(operation.stroke),
        opacity: operation.stroke.opacity,
      });
      break;
    case 'polyline':
      for (let index = 1; index < operation.points.length; index += 1) {
        const start = operation.points[index - 1];
        const end = operation.points[index];
        page.drawLine({
          start,
          end,
          thickness: operation.strokeWidth,
          color: colorOf(operation.stroke),
          opacity: operation.stroke.opacity,
        });
      }
      break;
    default:
      break;
  }
}

export function clonePdfBytes(source: ArrayBuffer | Uint8Array): Uint8Array {
  const view = source instanceof Uint8Array ? source : new Uint8Array(source);
  return Uint8Array.from(view);
}

/**
 * Largest point-size difference this module calls "the same size".
 *
 * A thousandth of a point: below anything a PDF states or the size control can
 * ask for (it steps in whole points), so it only ever absorbs the last bits of
 * a float. Exact `!==` here reported a size change nobody made — a 6pt line
 * read at one zoom is `5.999999999999999` and at another exactly `6` — which
 * turned every untouched line on the page into an edit and made the engine
 * refuse the whole atomic transaction. `documentFontSize` in
 * `editorTextBlockGeometry` stops new records disagreeing that way; this
 * tolerance also covers the records already sitting in a saved draft.
 */
export const TEXT_EDIT_FONT_SIZE_TOLERANCE = 1e-3;

export function isEffectiveTextEdit(
  edit: PdfEditorTextAppearance,
  source: PdfEditorSourceText,
): boolean {
  return edit.text !== source.text
    || !isSameFontSize(edit.fontSize, source.fontSize)
    || edit.fontFamily !== source.fontFamily
    || edit.color !== source.color
    || edit.bold
    || edit.italic
    || edit.underline
    || edit.align !== 'left'
    || edit.lineHeight !== 1.15
    || (edit.backgroundColor ?? 'transparent') !== 'transparent';
}

/** Sizes equal to within {@link TEXT_EDIT_FONT_SIZE_TOLERANCE}. */
function isSameFontSize(left: number, right: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return left === right;
  return Math.abs(left - right) <= TEXT_EDIT_FONT_SIZE_TOLERANCE;
}

export function countFabricCanvasObjects(canvasStates: Iterable<Record<string, unknown>>): number {
  let count = 0;
  for (const state of canvasStates) {
    if (!Array.isArray(state.objects)) continue;
    count += state.objects.length;
  }
  return count;
}