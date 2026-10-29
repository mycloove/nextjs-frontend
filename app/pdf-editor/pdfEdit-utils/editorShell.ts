export type PdfEditorFitMode = 'fit-page' | 'fit-width' | 'actual-size' | 'custom';
export type PdfEditorViewMode = 'single' | 'continuous';
export type PdfEditorNavigationTab = 'pages' | 'organize' | 'outline' | 'comments';

export const PDF_EDITOR_MIN_ZOOM = 0.4;
export const PDF_EDITOR_MAX_ZOOM = 3;

export function clampPdfEditorZoom(zoom: number) {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(PDF_EDITOR_MAX_ZOOM, Math.max(PDF_EDITOR_MIN_ZOOM, zoom));
}

export function calculatePdfEditorFitZoom(options: {
  mode: Exclude<PdfEditorFitMode, 'custom'>;
  pageWidth: number;
  pageHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  horizontalPadding?: number;
  verticalPadding?: number;
}) {
  if (options.mode === 'actual-size') return 1;

  const width = Math.max(1, options.viewportWidth - (options.horizontalPadding ?? 64));
  const height = Math.max(1, options.viewportHeight - (options.verticalPadding ?? 64));
  const widthScale = width / Math.max(1, options.pageWidth);
  if (options.mode === 'fit-width') return clampPdfEditorZoom(widthScale);
  return clampPdfEditorZoom(Math.min(widthScale, height / Math.max(1, options.pageHeight)));
}

export function normalizePdfEditorPageJump(value: string | number, totalPages: number) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || totalPages < 1) return null;
  return Math.min(totalPages, Math.max(1, Math.trunc(parsed)));
}

export function getPdfEditorVirtualRange(options: {
  scrollTop: number;
  viewportHeight: number;
  itemHeight: number;
  itemCount: number;
  overscan?: number;
}) {
  if (options.itemCount <= 0 || options.itemHeight <= 0) return { start: 0, end: 0 };
  const overscan = Math.max(0, options.overscan ?? 2);
  const visibleStart = Math.floor(Math.max(0, options.scrollTop) / options.itemHeight);
  const visibleEnd = Math.ceil((Math.max(0, options.scrollTop) + Math.max(0, options.viewportHeight)) / options.itemHeight);
  return {
    start: Math.max(0, visibleStart - overscan),
    end: Math.min(options.itemCount, visibleEnd + overscan),
  };
}

export function normalizePdfEditorSearchQuery(query: string) {
  return query.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function includesPdfEditorSearchQuery(text: string, query: string) {
  const normalizedQuery = normalizePdfEditorSearchQuery(query);
  return normalizedQuery.length >= 2 && normalizePdfEditorSearchQuery(text).includes(normalizedQuery);
}

export function retainPdfEditorSearchIndex(results: readonly { id: string }[], previousId: string | null, previousIndex: number) {
  const retained = results.findIndex(result => result.id === previousId);
  return retained >= 0 ? retained : Math.max(0, Math.min(results.length - 1, previousIndex));
}
