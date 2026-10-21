/**
 * W4 — annotation authoring model.
 *
 * Annotations are authored in the editor and written to the PDF as real PDF
 * annotation dictionaries, so a reviewer opening the file in Acrobat, Preview or
 * a browser sees them — and can still delete or reply to them. That is the
 * difference between this and the W2 canvas text/shape objects: those become
 * page content, which is final; annotations stay annotations.
 *
 * Coordinates are PDF points with a top-left origin in the page's visual space,
 * matching redaction marks and the vector export. The UI receives rendered
 * pixels, so converting a text run divides by the current zoom exactly once,
 * here, where the conversion is testable.
 *
 * Replies are ordinary annotations with `/IRT` pointing at their parent. Keeping
 * them in the same list (rather than a nested tree) means one persistence shape,
 * one undo entry and one export loop; the parent link is what makes the thread.
 */

import type { PdfEditorObjectGeometry } from './editorObjectOps.ts';

export type PdfEditorAnnotationKind =
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'note'
  | 'stamp'
  | 'link'
  | 'reply';

export type PdfEditorAnnotationSubtype =
  | 'Highlight'
  | 'Underline'
  | 'StrikeOut'
  | 'Text'
  | 'Stamp'
  | 'Link';

export type PdfEditorStampPreset = 'Approved' | 'Draft' | 'Confidential';

export const PDF_EDITOR_STAMP_PRESETS: readonly PdfEditorStampPreset[] = [
  'Approved',
  'Draft',
  'Confidential',
];

/** One annotation, in source-page point space. */
export type PdfEditorAnnotation = {
  id: string;
  kind: PdfEditorAnnotationKind;
  /** 1-based source page. Output positions are resolved at export time. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** `#rrggbb`. */
  color: string;
  author: string;
  contents: string;
  /** ISO-8601, what `/M` carries. */
  createdAt: string;
  /** Text-markup annotations only: the source run they were authored on. */
  blockKey?: string;
  /** Link target. Required when `kind` is `link`. */
  uri?: string;
  /** Stamp appearance name. Required when `kind` is `stamp`. */
  stamp?: PdfEditorStampPreset;
  /** Parent annotation id. Required when `kind` is `reply`. */
  replyTo?: string;
};

export type PdfEditorAnnotationSource = {
  page: number;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfEditorAnnotationError =
  | 'invalid-page'
  | 'invalid-box'
  | 'invalid-zoom'
  | 'invalid-uri'
  | 'invalid-stamp'
  | 'invalid-reply'
  | 'missing-contents';

export type PdfEditorAnnotationResult =
  | { ok: true; annotation: PdfEditorAnnotation }
  | { ok: false; reason: PdfEditorAnnotationError; message: string };

export type PdfEditorAnnotationToggleResult = {
  annotations: readonly PdfEditorAnnotation[];
  action: 'added' | 'removed';
};

export type PdfEditorAnnotationStyle = {
  color: string;
  author: string;
  stamp: PdfEditorStampPreset;
  uri: string;
};

export const PDF_EDITOR_DEFAULT_ANNOTATION_AUTHOR = 'Reviewer';
export const PDF_EDITOR_DEFAULT_STAMP: PdfEditorStampPreset = 'Approved';

const DEFAULT_COLORS: Record<PdfEditorAnnotationKind, string> = {
  highlight: '#ffe14d',
  underline: '#c44735',
  strikeout: '#c44735',
  note: '#c44735',
  stamp: '#c44735',
  link: '#2f6fb3',
  reply: '#c44735',
};

const TEXT_MARKUP_KINDS = new Set<PdfEditorAnnotationKind>([
  'highlight',
  'underline',
  'strikeout',
]);

export function isPdfEditorTextMarkupKind(kind: PdfEditorAnnotationKind): boolean {
  return TEXT_MARKUP_KINDS.has(kind);
}

export function pdfEditorAnnotationSubtype(kind: PdfEditorAnnotationKind): PdfEditorAnnotationSubtype {
  switch (kind) {
    case 'highlight': return 'Highlight';
    case 'underline': return 'Underline';
    case 'strikeout': return 'StrikeOut';
    case 'stamp': return 'Stamp';
    case 'link': return 'Link';
    default: return 'Text';
  }
}

export function pdfEditorAnnotationDefaultColor(kind: PdfEditorAnnotationKind): string {
  return DEFAULT_COLORS[kind];
}

export function pdfEditorAnnotationBlockKey(page: number, index: number): string {
  return `${page}:${index}`;
}

const finite = (value: number, fallback = 0) => (
  Number.isFinite(value) ? value : fallback
);

const roundPoint = (value: number) => Math.round(value * 1000) / 1000;

export function normalizePdfEditorAnnotationColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : fallback;
}

export function createPdfEditorAnnotationId(seed: number) {
  return `pe-annot-${Math.max(0, Math.round(finite(seed))).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function validateUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:';
  } catch {
    return false;
  }
}

/**
 * Validate and normalise one annotation.
 *
 * The refusal list is deliberately narrow and actionable: every reason here is
 * something the user can fix, and a malformed annotation is dropped rather than
 * written to a PDF in a shape a viewer may ignore.
 */
export function createPdfEditorAnnotation(input: {
  kind: PdfEditorAnnotationKind;
  page: number;
  geometry: Pick<PdfEditorObjectGeometry, 'x' | 'y' | 'width' | 'height'>;
  color?: string;
  author?: string;
  contents?: string;
  createdAt?: string;
  id?: string;
  blockKey?: string;
  uri?: string;
  stamp?: PdfEditorStampPreset;
  replyTo?: string;
}): PdfEditorAnnotationResult {
  if (!Number.isInteger(input.page) || input.page < 1) {
    return { ok: false, reason: 'invalid-page', message: 'An annotation needs a valid page number.' };
  }
  const width = finite(input.geometry.width);
  const height = finite(input.geometry.height);
  if (![input.geometry.x, input.geometry.y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return { ok: false, reason: 'invalid-box', message: 'This annotation has no usable box on the page.' };
  }

  const contents = (input.contents ?? '').trim();
  const requiresContents = input.kind === 'note' || input.kind === 'reply';
  if (requiresContents && !contents) {
    return {
      ok: false,
      reason: 'missing-contents',
      message: input.kind === 'reply'
        ? 'A reply needs text before it can be added.'
        : 'A note needs text before it can be added.',
    };
  }

  if (input.kind === 'link') {
    const uri = (input.uri ?? '').trim();
    if (!validateUri(uri)) {
      return {
        ok: false,
        reason: 'invalid-uri',
        message: 'A link annotation needs an http, https or mailto address.',
      };
    }
  }

  if (input.kind === 'reply' && (!input.replyTo || !input.replyTo.trim())) {
    return { ok: false, reason: 'invalid-reply', message: 'A reply must point at the annotation it answers.' };
  }

  const stamp = input.stamp ?? PDF_EDITOR_DEFAULT_STAMP;
  if (input.kind === 'stamp' && !PDF_EDITOR_STAMP_PRESETS.includes(stamp)) {
    return { ok: false, reason: 'invalid-stamp', message: 'Choose a supported stamp preset.' };
  }

  const fallbackColor = pdfEditorAnnotationDefaultColor(input.kind);
  return {
    ok: true,
    annotation: {
      id: input.id && input.id.trim() ? input.id : createPdfEditorAnnotationId(Date.now()),
      kind: input.kind,
      page: input.page,
      x: roundPoint(finite(input.geometry.x)),
      y: roundPoint(finite(input.geometry.y)),
      width: roundPoint(width),
      height: roundPoint(height),
      color: normalizePdfEditorAnnotationColor(input.color, fallbackColor),
      author: (input.author ?? '').trim() || PDF_EDITOR_DEFAULT_ANNOTATION_AUTHOR,
      contents,
      createdAt: input.createdAt ?? new Date().toISOString(),
      ...(input.blockKey ? { blockKey: input.blockKey } : {}),
      ...(input.kind === 'link' ? { uri: (input.uri ?? '').trim() } : {}),
      ...(input.kind === 'stamp' ? { stamp } : {}),
      ...(input.kind === 'reply' ? { replyTo: input.replyTo!.trim() } : {}),
    },
  };
}

/**
 * Convert a detected text run into an annotation box, at a known zoom.
 *
 * Same contract as `createPdfEditorRedactionMark`: the block arrives in rendered
 * pixels, the annotation is stored in points, and an invalid zoom is refused
 * rather than silently treated as 1.
 */
export function createPdfEditorTextAnnotation(input: {
  kind: 'highlight' | 'underline' | 'strikeout';
  source: PdfEditorAnnotationSource;
  zoom: number;
  color?: string;
  author?: string;
  contents?: string;
}): PdfEditorAnnotationResult {
  if (!Number.isInteger(input.source.page) || input.source.page < 1) {
    return { ok: false, reason: 'invalid-page', message: 'An annotation needs a valid page number.' };
  }
  if (!Number.isInteger(input.source.index) || input.source.index < 0) {
    return { ok: false, reason: 'invalid-box', message: 'This text run has no stable identity.' };
  }
  if (!Number.isFinite(input.zoom) || input.zoom <= 0) {
    return { ok: false, reason: 'invalid-zoom', message: 'The page has no usable zoom, so the box cannot be measured.' };
  }
  const width = input.source.width / input.zoom;
  const height = input.source.height / input.zoom;
  if (![input.source.x, input.source.y, input.source.width, input.source.height].every(Number.isFinite)
    || width <= 0 || height <= 0) {
    return { ok: false, reason: 'invalid-box', message: 'This text run has no usable box on the page.' };
  }
  return createPdfEditorAnnotation({
    kind: input.kind,
    page: input.source.page,
    geometry: {
      x: input.source.x / input.zoom,
      y: input.source.y / input.zoom,
      width,
      height,
    },
    color: input.color,
    author: input.author,
    contents: input.contents,
    blockKey: pdfEditorAnnotationBlockKey(input.source.page, input.source.index),
  });
}

/** Add a markup annotation, or remove the one already on this run. */
export function togglePdfEditorTextAnnotation(
  annotations: readonly PdfEditorAnnotation[],
  annotation: PdfEditorAnnotation,
): PdfEditorAnnotationToggleResult {
  const existing = annotations.findIndex(candidate => (
    candidate.kind === annotation.kind
    && candidate.blockKey !== undefined
    && candidate.blockKey === annotation.blockKey
  ));
  if (existing >= 0) {
    return {
      annotations: removePdfEditorAnnotation(annotations, annotations[existing].id),
      action: 'removed',
    };
  }
  return { annotations: [...annotations, annotation], action: 'added' };
}

/** Remove an annotation and every reply beneath it. */
export function removePdfEditorAnnotation(
  annotations: readonly PdfEditorAnnotation[],
  id: string,
): readonly PdfEditorAnnotation[] {
  const removed = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const annotation of annotations) {
      if (annotation.replyTo && removed.has(annotation.replyTo) && !removed.has(annotation.id)) {
        removed.add(annotation.id);
        changed = true;
      }
    }
  }
  return annotations.filter(annotation => !removed.has(annotation.id));
}

/**
 * Edit the fields a reviewer is allowed to edit after authoring. Kind, page and
 * box are identity; changing them silently would move a comment to a different
 * line, so those stay immutable.
 */
export function updatePdfEditorAnnotation(
  annotations: readonly PdfEditorAnnotation[],
  id: string,
  partial: Partial<Pick<PdfEditorAnnotation, 'author' | 'contents' | 'color' | 'uri' | 'stamp'>>,
): readonly PdfEditorAnnotation[] {
  return annotations.map((annotation) => {
    if (annotation.id !== id) return annotation;
    const next: PdfEditorAnnotation = { ...annotation };
    if (partial.author !== undefined) {
      next.author = partial.author.trim() || PDF_EDITOR_DEFAULT_ANNOTATION_AUTHOR;
    }
    if (partial.contents !== undefined) next.contents = partial.contents;
    if (partial.color !== undefined) {
      next.color = normalizePdfEditorAnnotationColor(
        partial.color,
        pdfEditorAnnotationDefaultColor(annotation.kind),
      );
    }
    if (partial.uri !== undefined && annotation.kind === 'link') {
      // Stored as typed. URI validity is enforced when the annotation is
      // exported, so a half-typed address does not fight the keystroke that is
      // still being entered.
      next.uri = partial.uri.trim();
    }
    if (partial.stamp !== undefined && annotation.kind === 'stamp'
      && PDF_EDITOR_STAMP_PRESETS.includes(partial.stamp)) {
      next.stamp = partial.stamp;
    }
    return next;
  });
}

export function pdfEditorAnnotationReplies(
  annotations: readonly PdfEditorAnnotation[],
  parentId: string,
): readonly PdfEditorAnnotation[] {
  return annotations.filter(annotation => annotation.replyTo === parentId);
}

export type PdfEditorAnnotationImpact = {
  count: number;
  pages: number[];
  summary: string;
};

export function describePdfEditorAnnotationImpact(
  annotations: readonly PdfEditorAnnotation[],
): PdfEditorAnnotationImpact {
  const pages = [...new Set(annotations.map(annotation => annotation.page))].sort((left, right) => left - right);
  const count = annotations.length;
  if (count === 0) return { count, pages, summary: 'No annotations will be added to the export.' };
  return {
    count,
    pages,
    summary: `${count} annotation${count === 1 ? '' : 's'} on page${pages.length === 1 ? '' : 's'} ${pages.join(', ')} will be written into the exported file as real PDF annotations.`,
  };
}

/**
 * Resolve each annotation's source page to the output position(s) it appears at
 * after the page plan. A duplicated source page carries its annotations on every
 * output occurrence; a deleted source page simply has none.
 *
 * Occurrences after the first get a suffixed id (`id#2`). Adobe treats `/NM` as
 * an identity, and two annotations on different pages sharing one would make the
 * export verifier — and a reviewer's reply thread — ambiguous. The first
 * occurrence keeps the original id, so the common case is unchanged.
 */
export function mapPdfEditorAnnotationsToOutput(
  annotations: readonly PdfEditorAnnotation[],
  entries: readonly { sourcePage: number }[] | null | undefined,
): PdfEditorAnnotation[] {
  if (!entries || entries.length === 0) return [...annotations];

  const positions = new Map<number, number[]>();
  entries.forEach((entry, index) => {
    const list = positions.get(entry.sourcePage) ?? [];
    list.push(index + 1);
    positions.set(entry.sourcePage, list);
  });

  const rootByPage = annotations.filter(annotation => !annotation.replyTo);
  const repliesByParent = new Map<string, PdfEditorAnnotation[]>();
  for (const annotation of annotations) {
    if (!annotation.replyTo) continue;
    const children = repliesByParent.get(annotation.replyTo) ?? [];
    children.push(annotation);
    repliesByParent.set(annotation.replyTo, children);
  }

  const mapped: PdfEditorAnnotation[] = [];
  const visitedReplies = new Set<string>();
  const occurrenceId = (id: string, index: number) => (
    index === 0 ? id : `${id}#${index + 1}`
  );

  const mapReplies = (
    originalParentId: string,
    mappedParentId: string,
    outputPage: number,
    occurrenceIndex: number,
    chain: Set<string>,
  ) => {
    if (chain.has(originalParentId)) return;
    const nextChain = new Set(chain).add(originalParentId);
    for (const child of repliesByParent.get(originalParentId) ?? []) {
      const visitKey = `${child.id}#${occurrenceIndex}`;
      if (visitedReplies.has(visitKey)) continue;
      visitedReplies.add(visitKey);
      const childId = occurrenceId(child.id, occurrenceIndex);
      mapped.push({ ...child, id: childId, page: outputPage, replyTo: mappedParentId });
      mapReplies(child.id, childId, outputPage, occurrenceIndex, nextChain);
    }
  };

  for (const root of rootByPage) {
    const pages = positions.get(root.page) ?? [];
    pages.forEach((outputPage, occurrenceIndex) => {
      const mappedId = occurrenceId(root.id, occurrenceIndex);
      mapped.push({ ...root, id: mappedId, page: outputPage });
      mapReplies(root.id, mappedId, outputPage, occurrenceIndex, new Set());
    });
  }

  // A reply whose parent cannot be resolved is kept, unchanged, so the export
  // refuses loudly instead of silently dropping a review comment.
  for (const annotation of annotations) {
    if (!annotation.replyTo) continue;
    if (visitedReplies.has(`${annotation.id}#0`)) continue;
    if (!annotations.some(candidate => candidate.id === annotation.replyTo)) {
      mapped.push(annotation);
    }
  }

  return mapped;
}

/** Reject a reply whose parent was removed by a malformed draft or an edit. */
export function pruneOrphanPdfEditorAnnotations(
  annotations: readonly PdfEditorAnnotation[],
): readonly PdfEditorAnnotation[] {
  const ids = new Set(annotations.map(annotation => annotation.id));
  return annotations.filter(annotation => !annotation.replyTo || ids.has(annotation.replyTo));
}

/** Draft recovery drops malformed annotations individually, never the draft. */
export function normalizePdfEditorAnnotations(value: unknown): PdfEditorAnnotation[] {
  if (!Array.isArray(value)) return [];
  const annotations: PdfEditorAnnotation[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    const kind = record.kind;
    if (typeof kind !== 'string' || ![
      'highlight', 'underline', 'strikeout', 'note', 'stamp', 'link', 'reply',
    ].includes(kind)) continue;
    const page = record.page;
    const x = record.x;
    const y = record.y;
    const width = record.width;
    const height = record.height;
    if (!Number.isInteger(page) || (page as number) < 1) continue;
    if (![x, y, width, height].every(item => typeof item === 'number' && Number.isFinite(item))) continue;
    if ((width as number) <= 0 || (height as number) <= 0) continue;

    const result = createPdfEditorAnnotation({
      kind: kind as PdfEditorAnnotationKind,
      page: page as number,
      geometry: { x: x as number, y: y as number, width: width as number, height: height as number },
      color: typeof record.color === 'string' ? record.color : undefined,
      author: typeof record.author === 'string' ? record.author : undefined,
      contents: typeof record.contents === 'string' ? record.contents : undefined,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
      id: typeof record.id === 'string' ? record.id : undefined,
      blockKey: typeof record.blockKey === 'string' ? record.blockKey : undefined,
      uri: typeof record.uri === 'string' ? record.uri : undefined,
      stamp: typeof record.stamp === 'string' ? record.stamp as PdfEditorStampPreset : undefined,
      replyTo: typeof record.replyTo === 'string' ? record.replyTo : undefined,
    });
    if (!result.ok) continue;
    if (seen.has(result.annotation.id)) continue;
    seen.add(result.annotation.id);
    annotations.push(result.annotation);
  }

  return [...pruneOrphanPdfEditorAnnotations(annotations)];
}
