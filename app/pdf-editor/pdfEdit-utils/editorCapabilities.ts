import type { TextStyle } from '../pdfEdit-hooks/usePdfEditor';

export const ORIGINAL_TEXT_STYLE_LIMITS = {
  heading: 'Heading presets cannot reliably change inherited original-text styles.',
  fontFamily: 'Original typeface selection is not sent to the structural engine. A required substitute is disclosed in the export preview.',
  bold: 'The engine cannot reliably add or remove inherited bold styling.',
  italic: 'The engine cannot reliably add or remove inherited italic styling.',
  underline: 'Original-text underline is not supported. Use a native underline annotation on a supported page.',
  bgColor: 'Original-text fill is not supported. Use a highlight annotation on a supported page.',
  lineHeight: 'The engine may tighten line spacing to fit without reporting the exact spacing used.',
} as const;

/** Added objects use the full style path; original text offers only honored settings. */
export function supportedOriginalTextStyle(partial: Partial<TextStyle>): Partial<TextStyle> {
  const result: Partial<TextStyle> = {};
  if (partial.fontSize !== undefined && Number.isFinite(partial.fontSize)) {
    result.fontSize = Math.min(200, Math.max(6, partial.fontSize));
  }
  if (partial.color !== undefined) result.color = partial.color;
  if (partial.align !== undefined) result.align = partial.align;
  return result;
}

export function pdfEditorAnnotationBlocker(input: {
  page: number;
  pageSize: string;
  sourceRotation: number | undefined;
  entries: readonly { sourcePage: number; rotation: number }[];
}): string | null {
  if (input.pageSize !== 'original') {
    return 'Native annotations require Original page size. Change back to Original before placing annotations.';
  }
  if (!Number.isFinite(input.sourceRotation)) {
    return `Page ${input.page} rotation has not been inspected. Annotation placement is unavailable until it can be checked locally.`;
  }
  if (input.sourceRotation! % 360 !== 0
    || input.entries.some(entry => entry.sourcePage === input.page && entry.rotation % 360 !== 0)) {
    return `Native annotations require unrotated source and output pages. Page ${input.page} is rotated; its existing annotations are retained but cannot be exported in this layout.`;
  }
  return null;
}
