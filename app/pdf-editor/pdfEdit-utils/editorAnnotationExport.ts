/**
 * W4 — write annotations into the PDF and prove they are there.
 *
 * pdf-lib has no annotation API, so this module builds the dictionaries at the
 * object level. The shape is the one the PDF specification defines, not a
 * private convention:
 *
 *   /Type /Annot, /Subtype, /Rect, /C, /T, /Contents, /NM, /M, /F
 *   /QuadPoints on text markup, /A on links, /Name on stamps, /IRT + /RT on replies
 *
 * Text markup and stamp annotations also receive an appearance stream (`/AP
 * /N`). Without one, viewers are free to draw nothing at all; with one, the
 * annotation looks the same in Acrobat, Preview and PDF.js, and the export
 * preview can render the real bytes (P = E).
 *
 * Rotated pages are refused. Mapping a visual-space box onto a rotated page's
 * user space is possible, but getting the rotation direction wrong writes the
 * annotation silently in the wrong place — worse than a refusal, and exactly the
 * class of quiet failure this editor's contracts forbid.
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
} from 'pdf-lib';
import type { PDFContext, PDFDict as PDFDictType, PDFFont, PDFObject, PDFPage } from 'pdf-lib';

/**
 * The literal shape pdf-lib accepts when building dictionaries by hand: names,
 * numbers, arrays, and refs it has already registered. Typing this locally (the
 * package does not export its `Literal` alias) keeps `context.obj` on the
 * `PDFDict` overload instead of degrading the result to `never`.
 */
type PdfLiteral =
  | boolean
  | number
  | string
  | null
  | undefined
  | PDFObject
  | PdfLiteral[]
  | { [key: string]: PdfLiteral };

import {
  pdfEditorAnnotationSubtype,
  type PdfEditorAnnotation,
  type PdfEditorAnnotationSubtype,
} from './editorAnnotations.ts';

export class PdfEditorAnnotationExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfEditorAnnotationExportError';
  }
}

export type PdfEditorAnnotationExportInput = {
  source: ArrayBuffer | Uint8Array;
  /** Annotations already resolved to output page numbers. */
  annotations: readonly PdfEditorAnnotation[];
};

export type PdfEditorAnnotationExportResult = {
  bytes: Uint8Array;
  written: number;
};

export type PdfEditorAnnotationExpectation = PdfEditorAnnotation & {
  subtype: PdfEditorAnnotationSubtype;
};

export type PdfEditorAnnotationVerification = {
  ok: boolean;
  checks: { id: string; status: 'passed' | 'failed'; detail: string }[];
  failures: string[];
};

const FINITE = (value: number, fallback = 0) => (
  Number.isFinite(value) ? value : fallback
);

function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim();
  if (!/^[0-9a-f]{6}$/i.test(clean)) return { r: 0.78, g: 0.28, b: 0.21 };
  return {
    r: parseInt(clean.slice(0, 2), 16) / 255,
    g: parseInt(clean.slice(2, 4), 16) / 255,
    b: parseInt(clean.slice(4, 6), 16) / 255,
  };
}

function pdfDate(iso: string): PDFString {
  const date = new Date(iso);
  return PDFString.fromDate(Number.isNaN(date.getTime()) ? new Date() : date);
}

/**
 * Ensure `/Annots` is a direct array we can append to.
 *
 * A source document may store the array itself indirectly. Writing the looked-up
 * array back onto the page is legal and keeps every existing annotation ref in
 * place; replacing it with a fresh array would drop them.
 */
function pageAnnotations(page: PDFPage, context: PDFContext): PDFArray {
  const existing = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (existing) return existing;
  const created = context.obj([]);
  page.node.set(PDFName.of('Annots'), created);
  return created;
}

function makeAppearanceStream(
  context: PDFContext,
  width: number,
  height: number,
  operators: string,
  options: {
    opacity?: number;
    font?: PDFFont;
  } = {},
): PDFRef {
  const resources: { [key: string]: PdfLiteral } = {};
  if (options.opacity !== undefined && options.opacity < 1) {
    const graphicsState = context.register(context.obj({
      Type: 'ExtGState',
      ca: options.opacity,
      CA: options.opacity,
    }));
    resources.ExtGState = { GS0: graphicsState };
  }
  if (options.font) {
    resources.Font = { Helv: options.font.ref };
  }

  const stream = context.stream(operators, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [0, 0, Math.max(1, width), Math.max(1, height)],
    Resources: resources,
  });
  return context.register(stream);
}

function appearanceOperators(annotation: PdfEditorAnnotation, color: { r: number; g: number; b: number }) {
  const { width, height } = annotation;
  const fill = `${color.r} ${color.g} ${color.b} rg`;
  const stroke = `${color.r} ${color.g} ${color.b} RG`;
  const w = Math.max(1, width);
  const h = Math.max(1, height);

  switch (annotation.kind) {
    case 'highlight':
      return `/GS0 gs ${fill} 0 0 ${w} ${h} re f`;
    case 'underline': {
      const bar = Math.max(1, Math.min(2.5, h * 0.12));
      return `/GS0 gs ${fill} 0 0 ${w} ${bar} re f`;
    }
    case 'strikeout': {
      const bar = Math.max(1, Math.min(2.5, h * 0.12));
      return `/GS0 gs ${fill} 0 ${Math.max(0, (h - bar) / 2)} ${w} ${bar} re f`;
    }
    case 'note':
    case 'reply': {
      // A small pinned page with two ruled lines: legible at 24pt without an
      // external icon font, and it survives any viewer's annotation flags. A
      // reply uses the same icon; the thread lives in /IRT.
      const pad = Math.max(1, Math.min(3, w * 0.12));
      return [
        `/GS0 gs ${fill} 0 0 ${w} ${h} re f`,
        `${stroke} ${Math.max(0.6, w * 0.06)} w`,
        `1 0 0 1 ${pad} ${h - pad * 2} cm`,
        `0 0 ${Math.max(1, w - pad * 2)} ${Math.max(1, h - pad * 2)} re S`,
        `${pad * 2} ${h * 0.62} m ${w - pad * 2} ${h * 0.62} l S`,
        `${pad * 2} ${h * 0.38} m ${w - pad * 3} ${h * 0.38} l S`,
      ].join('\n');
    }
    case 'stamp': {
      const border = Math.max(1, Math.min(2.5, h * 0.09));
      // The built-in stamp names are ASCII. Helvetica needs those single-byte
      // character codes, not the UTF-16 strings used in annotation dictionaries.
      const label = (annotation.stamp ?? 'Approved').toUpperCase();
      const encodedLabel = PDFHexString.of([...label].map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
      return [
        `${stroke} ${border} w 0 0 ${w} ${h} re S`,
        `BT /Helv ${Math.max(5, Math.min(12, h * 0.42))} Tf ${color.r} ${color.g} ${color.b} rg`,
        `1 0 0 1 ${Math.max(2, w * 0.06)} ${Math.max(2, h * 0.32)} Tm`,
        `${encodedLabel} Tj ET`,
      ].join('\n');
    }
    default:
      return '';
  }
}

export async function exportPdfEditorAnnotations(
  input: PdfEditorAnnotationExportInput,
): Promise<PdfEditorAnnotationExportResult> {
  if (input.annotations.length === 0) {
    return {
      bytes: input.source instanceof Uint8Array
        ? Uint8Array.from(input.source)
        : new Uint8Array(input.source.slice(0)),
      written: 0,
    };
  }

  const pdf = await PDFDocument.load(input.source, {
    updateMetadata: false,
    throwOnInvalidObject: true,
  });
  const pages = pdf.getPages();

  for (const annotation of input.annotations) {
    if (!Number.isInteger(annotation.page) || annotation.page < 1 || annotation.page > pages.length) {
      throw new PdfEditorAnnotationExportError(
        `Annotation "${annotation.id}" targets page ${annotation.page}, which does not exist in the exported document.`,
      );
    }
    if (annotation.kind === 'link') {
      const uri = annotation.uri?.trim() ?? '';
      let valid = false;
      try {
        const parsed = new URL(uri);
        valid = parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:';
      } catch {
        valid = false;
      }
      if (!valid) {
        throw new PdfEditorAnnotationExportError(
          `Link annotation "${annotation.id}" has no usable http, https or mailto address, so it was not exported.`,
        );
      }
    }
    if ((annotation.kind === 'note' || annotation.kind === 'reply') && !annotation.contents.trim()) {
      throw new PdfEditorAnnotationExportError(
        `Annotation "${annotation.id}" is a ${annotation.kind} with no text, so it was not exported.`,
      );
    }
    const rotation = pages[annotation.page - 1].getRotation().angle % 360;
    const box = pages[annotation.page - 1].getCropBox();
    if (![annotation.x, annotation.y, annotation.width, annotation.height].every(Number.isFinite)
      || annotation.x < 0 || annotation.y < 0 || annotation.width <= 0 || annotation.height <= 0
      || annotation.x + annotation.width > box.width + 0.01 || annotation.y + annotation.height > box.height + 0.01) {
      throw new PdfEditorAnnotationExportError(`Annotation "${annotation.id}" has invalid or clipped page geometry. It was not exported.`);
    }
    if (rotation !== 0) {
      throw new PdfEditorAnnotationExportError(
        `Annotation "${annotation.id}" is on page ${annotation.page}, which is rotated. `
        + 'Annotations are refused on rotated pages rather than written in a position the reader would see differently.',
      );
    }
  }

  const stampFont = input.annotations.some(annotation => annotation.kind === 'stamp')
    ? await pdf.embedFont(StandardFonts.Helvetica)
    : null;

  const context = pdf.context;
  const refById = new Map<string, PDFRef>();
  const ordered = [
    ...input.annotations.filter(annotation => annotation.kind !== 'reply'),
    ...input.annotations.filter(annotation => annotation.kind === 'reply'),
  ];

  for (const annotation of ordered) {
    if (refById.has(annotation.id)) {
      throw new PdfEditorAnnotationExportError(
        `Two annotations share the id "${annotation.id}", so their replies would be ambiguous.`,
      );
    }

    let parentRef: PDFRef | undefined;
    if (annotation.kind === 'reply') {
      parentRef = annotation.replyTo ? refById.get(annotation.replyTo) : undefined;
      if (!parentRef) {
        throw new PdfEditorAnnotationExportError(
          `Reply "${annotation.id}" points at annotation "${annotation.replyTo}", which is not part of this export.`,
        );
      }
    }

    const page = pages[annotation.page - 1];
    const cropBox = page.getCropBox();
    const left = cropBox.x + FINITE(annotation.x);
    const top = cropBox.y + cropBox.height - FINITE(annotation.y);
    const rect = [
      left,
      top - Math.max(0.1, FINITE(annotation.height)),
      left + Math.max(0.1, FINITE(annotation.width)),
      top,
    ] as const;
    const color = hexToRgb01(annotation.color);
    const subtype = pdfEditorAnnotationSubtype(annotation.kind);

    const literal: { [key: string]: PdfLiteral } = {
      Type: 'Annot',
      Subtype: subtype,
      Rect: [...rect],
      C: [color.r, color.g, color.b],
      T: PDFHexString.fromText(annotation.author),
      Contents: PDFHexString.fromText(annotation.contents),
      NM: PDFHexString.fromText(annotation.id),
      M: pdfDate(annotation.createdAt),
      F: 4,
    };

    if (annotation.kind === 'highlight' || annotation.kind === 'underline' || annotation.kind === 'strikeout') {
      literal.QuadPoints = [
        rect[0], rect[3],
        rect[2], rect[3],
        rect[0], rect[1],
        rect[2], rect[1],
      ];
    }
    if (annotation.kind === 'link') {
      literal.A = context.obj({
        S: 'URI',
        URI: PDFString.of(annotation.uri ?? ''),
      });
      literal.Border = [0, 0, 0];
    }
    if (annotation.kind === 'stamp') {
      literal.Name = annotation.stamp ?? 'Approved';
    }
    if (annotation.kind === 'note' || annotation.kind === 'reply') {
      literal.Name = 'Comment';
      literal.Open = false;
    }
    if (parentRef) {
      literal.IRT = parentRef;
      literal.RT = 'R';
    }

    const dict = context.obj(literal) as PDFDictType;
    const operatorsForAppearance = appearanceOperators(annotation, color);
    if (operatorsForAppearance) {
      const appearanceRef = makeAppearanceStream(
        context,
        annotation.width,
        annotation.height,
        operatorsForAppearance,
        {
          opacity: annotation.kind === 'highlight' ? 0.5 : 0.9,
          ...(annotation.kind === 'stamp' && stampFont ? { font: stampFont } : {}),
        },
      );
      dict.set(PDFName.of('AP'), context.obj({ N: appearanceRef }));
    }

    const ref = context.register(dict);
    refById.set(annotation.id, ref);
    pageAnnotations(page, context).push(ref);
  }

  return {
    bytes: await pdf.save({ addDefaultPage: false, updateFieldAppearances: false }),
    written: input.annotations.length,
  };
}

export function pdfEditorAnnotationExpectations(
  annotations: readonly PdfEditorAnnotation[],
): PdfEditorAnnotationExpectation[] {
  return annotations.map(annotation => ({
    ...annotation,
    subtype: pdfEditorAnnotationSubtype(annotation.kind),
  }));
}

function readName(dict: PDFDict, key: string): string | null {
  const name = dict.lookupMaybe(PDFName.of(key), PDFName);
  return name ? name.decodeText() : null;
}

function readText(dict: PDFDict, key: string): string | null {
  const value = dict.lookupMaybe(PDFName.of(key), PDFString, PDFHexString);
  return value ? value.decodeText() : null;
}

function matchesNumbers(dict: PDFDict, key: string, expected: readonly number[]) {
  const value = dict.lookupMaybe(PDFName.of(key), PDFArray);
  return !!value && value.size() === expected.length && expected.every((number, index) => {
    const actual = value.lookupMaybe(index, PDFNumber);
    return !!actual && Math.abs(actual.asNumber() - number) < 0.001;
  });
}

/**
 * Re-open the written bytes and prove every annotation is present.
 *
 * The check is identity-based (`/NM`), not count-based: a count alone would pass
 * if a viewer-facing dictionary were written twice and another were dropped.
 */
export async function verifyPdfEditorAnnotationExport(input: {
  outputBytes: ArrayBuffer | Uint8Array;
  expectations: readonly PdfEditorAnnotationExpectation[];
}): Promise<PdfEditorAnnotationVerification> {
  const checks: PdfEditorAnnotationVerification['checks'] = [];
  const failures: string[] = [];
  if (input.expectations.length === 0) return { ok: true, checks, failures };

  let pdf;
  try {
    pdf = await PDFDocument.load(input.outputBytes, { updateMetadata: false });
  } catch (error) {
    const message = `The exported PDF could not be reopened to verify its annotations: ${error instanceof Error ? error.message : 'invalid PDF'}`;
    return { ok: false, checks: [{ id: 'annotation-reopen', status: 'failed', detail: message }], failures: [message] };
  }

  try {
  const pages = pdf.getPages();
  // Keyed by id *and* page: a duplicated source page legitimately carries the
  // same annotation on two output pages, with `/NM` suffixed on the copy.
  const found = new Map<string, { subtype: string; dict: PDFDict }>();
  const duplicates = new Set<string>();
  pages.forEach((page, pageIndex) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) return;
    for (let index = 0; index < annots.size(); index += 1) {
      const dict = annots.lookupMaybe(index, PDFDict);
      if (!dict) continue;
      const id = readText(dict, 'NM');
      if (!id) continue;
      const key = `${id}@${pageIndex + 1}`;
      if (found.has(key)) duplicates.add(key);
      found.set(key, { subtype: readName(dict, 'Subtype') ?? '', dict });
    }
  });

  for (const expectation of input.expectations) {
    const actual = found.get(`${expectation.id}@${expectation.page}`);
    if (!actual) {
      const detail = `Annotation ${expectation.id} (${expectation.subtype}) on page ${expectation.page} is missing from the exported PDF.`;
      checks.push({ id: `annotation-${expectation.id}-${expectation.page}`, status: 'failed', detail });
      failures.push(detail);
      continue;
    }
    if (actual.subtype !== expectation.subtype) {
      const detail = `Annotation ${expectation.id} was written as /${actual.subtype}, expected /${expectation.subtype}.`;
      checks.push({ id: `annotation-${expectation.id}-${expectation.page}`, status: 'failed', detail });
      failures.push(detail);
      continue;
    }
    if (expectation.replyTo) {
      // `get` not `lookup`: the latter resolves the reference to the parent
      // dictionary, and the proof is that the reference itself exists.
      const parent = actual.dict.get(PDFName.of('IRT'));
      const replyType = readName(actual.dict, 'RT');
      if (!(parent instanceof PDFRef) || replyType !== 'R') {
        const detail = `Reply ${expectation.id} is not linked to its parent annotation.`;
        checks.push({ id: `annotation-${expectation.id}-${expectation.page}`, status: 'failed', detail });
        failures.push(detail);
        continue;
      }
    }
    if (expectation.uri) {
      const action = actual.dict.lookupMaybe(PDFName.of('A'), PDFDict);
      const uri = action ? readText(action, 'URI') : null;
      if (uri !== expectation.uri || !action || readName(action, 'S') !== 'URI') {
        const detail = `Link ${expectation.id} carries "${uri ?? '(none)'}" instead of "${expectation.uri}".`;
        checks.push({ id: `annotation-${expectation.id}-${expectation.page}`, status: 'failed', detail });
        failures.push(detail);
        continue;
      }
    }
    const mismatches: string[] = [];
    if (duplicates.has(`${expectation.id}@${expectation.page}`)) mismatches.push('duplicate identity');
    if (readName(actual.dict, 'Type') !== 'Annot') mismatches.push('annotation type');
    if (actual.dict.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() !== 4) mismatches.push('visibility/print flags');
    if (['OC', 'CA', 'BM'].some(key => actual.dict.has(PDFName.of(key)))) mismatches.push('unverified annotation appearance override');
    if (readText(actual.dict, 'Contents') !== expectation.contents) mismatches.push('contents');
    if (readText(actual.dict, 'T') !== expectation.author) mismatches.push('author');
    const crop = pages[expectation.page - 1].getCropBox();
    const left = crop.x + expectation.x;
    const top = crop.y + crop.height - expectation.y;
    const rect = [left, top - expectation.height, left + expectation.width, top];
    if (!matchesNumbers(actual.dict, 'Rect', rect)) mismatches.push('rectangle');
    const color = hexToRgb01(expectation.color);
    if (!matchesNumbers(actual.dict, 'C', [color.r, color.g, color.b])) mismatches.push('color');
    if (['highlight', 'underline', 'strikeout'].includes(expectation.kind)
      && !matchesNumbers(actual.dict, 'QuadPoints', [rect[0], rect[3], rect[2], rect[3], rect[0], rect[1], rect[2], rect[1]])) mismatches.push('text quadrilaterals');
    if (expectation.kind === 'stamp' && readName(actual.dict, 'Name') !== (expectation.stamp ?? 'Approved')) mismatches.push('stamp');
    if (expectation.replyTo) {
      const expectedParent = input.expectations.find(item => item.id === expectation.replyTo);
      const parent = actual.dict.get(PDFName.of('IRT'));
      if (!expectedParent || !(parent instanceof PDFRef)
        || pdf.context.lookup(parent) !== found.get(`${expectation.replyTo}@${expectedParent.page}`)?.dict) mismatches.push('reply parent');
    }
    const operators = appearanceOperators(expectation, color);
    if (operators) {
      const ap = actual.dict.lookupMaybe(PDFName.of('AP'), PDFDict);
      const stream = ap?.lookup(PDFName.of('N'));
      if (!(stream instanceof PDFRawStream)
        || !matchesNumbers(stream.dict, 'BBox', [0, 0, Math.max(1, expectation.width), Math.max(1, expectation.height)])
        || new TextDecoder().decode(decodePDFRawStream(stream).decode()).replace(/\s+/g, ' ').trim() !== operators.replace(/\s+/g, ' ').trim()) mismatches.push('appearance');
      else {
        if (readName(stream.dict, 'Type') !== 'XObject' || readName(stream.dict, 'Subtype') !== 'Form'
          || stream.dict.lookupMaybe(PDFName.of('FormType'), PDFNumber)?.asNumber() !== 1) mismatches.push('appearance form');
        if (stream.dict.has(PDFName.of('Matrix')) && !matchesNumbers(stream.dict, 'Matrix', [1, 0, 0, 1, 0, 0])) mismatches.push('appearance matrix');
        if (['Group', 'OC', 'Ref'].some(key => stream.dict.has(PDFName.of(key)))) mismatches.push('unverified appearance override');
        const resources = stream.dict.lookupMaybe(PDFName.of('Resources'), PDFDict);
        if (resources?.keys().some(key => !['ExtGState', 'Font'].includes(key.decodeText()))) mismatches.push('unverified appearance resources');
        // Equal operators do not imply equal paint: GS0 can make them invisible,
        // and a substituted font can draw different glyphs for the same codes.
        // Accept only the resource semantics emitted by this writer.
        const graphicsState = resources?.lookupMaybe(PDFName.of('ExtGState'), PDFDict)?.lookupMaybe(PDFName.of('GS0'), PDFDict);
        const opacity = expectation.kind === 'highlight' ? 0.5 : 0.9;
        if (!graphicsState || readName(graphicsState, 'Type') !== 'ExtGState'
          || graphicsState.lookupMaybe(PDFName.of('ca'), PDFNumber)?.asNumber() !== opacity
          || graphicsState.lookupMaybe(PDFName.of('CA'), PDFNumber)?.asNumber() !== opacity
          || graphicsState.keys().some(key => !['Type', 'ca', 'CA'].includes(key.decodeText()))) mismatches.push('appearance opacity/graphics state');
        if (expectation.kind === 'stamp') {
          const font = resources?.lookupMaybe(PDFName.of('Font'), PDFDict)?.lookupMaybe(PDFName.of('Helv'), PDFDict);
          if (!font || readName(font, 'Type') !== 'Font' || readName(font, 'Subtype') !== 'Type1'
            || readName(font, 'BaseFont') !== StandardFonts.Helvetica || readName(font, 'Encoding') !== 'WinAnsiEncoding'
            || font.keys().some(key => !['Type', 'Subtype', 'BaseFont', 'Encoding'].includes(key.decodeText()))) mismatches.push('appearance font resource');
        }
      }
    }
    if (mismatches.length) {
      const detail = `Annotation ${expectation.id} on page ${expectation.page} does not match its intended ${mismatches.join(', ')}.`;
      checks.push({ id: `annotation-${expectation.id}-${expectation.page}`, status: 'failed', detail });
      failures.push(detail);
      continue;
    }
    checks.push({
      id: `annotation-${expectation.id}-${expectation.page}`,
      status: 'passed',
      detail: `${expectation.subtype} annotation on page ${expectation.page} matches its checked content, geometry, flags, normal appearance operators/resources and relationships; pixel rendering is not compared.`,
    });
  }
  } catch (error) {
    const detail = `The annotation dictionaries are malformed: ${error instanceof Error ? error.message : 'unreadable annotation data'}`;
    checks.push({ id: 'annotation-dictionaries', status: 'failed', detail });
    failures.push(detail);
  }

  return { ok: failures.length === 0, checks, failures };
}

