/**
 * Pure command catalogue and ranking for the editor palette.
 *
 * Kept free of React and of the editor hook so the order and filtering can be
 * tested without a DOM. Actions are resolved by the caller from the stable id.
 */

export type PdfEditorCommandGroup = 'Tools' | 'View' | 'Navigate' | 'Panels' | 'Document';

export type PdfEditorCommand = {
  id: string;
  label: string;
  group: PdfEditorCommandGroup;
  keywords: string[];
  shortcut?: string;
};

export const PDF_EDITOR_COMMANDS: readonly PdfEditorCommand[] = [
  { id: 'tool-select', label: 'Select tool', group: 'Tools', keywords: ['pointer', 'move', 'select'] },
  { id: 'tool-editText', label: 'Edit original text', group: 'Tools', keywords: ['text', 'replace', 'edit'] },
  { id: 'tool-text', label: 'Add text box', group: 'Tools', keywords: ['text', 'insert', 'type'] },
  { id: 'tool-highlight', label: 'Highlight', group: 'Tools', keywords: ['mark', 'highlight'] },
  { id: 'tool-annotate', label: 'Annotate', group: 'Tools', keywords: ['comment', 'note', 'stamp', 'link', 'review'] },
  { id: 'tool-signature', label: 'Draw signature', group: 'Tools', keywords: ['sign', 'signature'] },
  { id: 'tool-shape-rect', label: 'Add rectangle', group: 'Tools', keywords: ['shape', 'box', 'rect'] },
  { id: 'tool-shape-circle', label: 'Add ellipse', group: 'Tools', keywords: ['shape', 'circle', 'ellipse'] },
  { id: 'tool-shape-line', label: 'Add line', group: 'Tools', keywords: ['shape', 'line'] },
  { id: 'tool-shape-arrow', label: 'Add arrow', group: 'Tools', keywords: ['shape', 'arrow'] },
  { id: 'tool-image', label: 'Insert image', group: 'Tools', keywords: ['image', 'picture', 'photo'] },
  { id: 'tool-emoji', label: 'Insert emoji', group: 'Tools', keywords: ['emoji', 'sticker'] },
  { id: 'view-fit-page', label: 'Fit page', group: 'View', keywords: ['zoom', 'fit', 'page'], shortcut: '1' },
  { id: 'view-fit-width', label: 'Fit width', group: 'View', keywords: ['zoom', 'fit', 'width'], shortcut: '2' },
  { id: 'view-actual', label: 'Actual size', group: 'View', keywords: ['zoom', '100', 'actual', 'fit'], shortcut: '3' },
  { id: 'view-single', label: 'Single page view', group: 'View', keywords: ['layout', 'single'] },
  { id: 'view-continuous', label: 'Continuous view', group: 'View', keywords: ['layout', 'scroll', 'continuous'] },
  { id: 'page-prev', label: 'Previous page', group: 'Navigate', keywords: ['page', 'back'], shortcut: '←' },
  { id: 'page-next', label: 'Next page', group: 'Navigate', keywords: ['page', 'forward'], shortcut: '→' },
  { id: 'page-first', label: 'First page', group: 'Navigate', keywords: ['page', 'start'], shortcut: 'Home' },
  { id: 'page-last', label: 'Last page', group: 'Navigate', keywords: ['page', 'end'], shortcut: 'End' },
  { id: 'panel-organizer', label: 'Arrange pages', group: 'Panels', keywords: ['organize', 'reorder', 'rotate', 'delete', 'duplicate'] },
  { id: 'panel-navigation', label: 'Toggle navigation panel', group: 'Panels', keywords: ['pages', 'outline', 'comments', 'panel'] },
  { id: 'panel-inspector', label: 'Toggle inspector', group: 'Panels', keywords: ['properties', 'style', 'panel'] },
  { id: 'document-preview', label: 'Preview final PDF', group: 'Document', keywords: ['preview', 'export', 'check'] },
  { id: 'document-export', label: 'Download PDF', group: 'Document', keywords: ['export', 'download', 'save'], shortcut: 'Ctrl S' },
  { id: 'edit-undo', label: 'Undo', group: 'Document', keywords: ['undo', 'revert'], shortcut: 'Ctrl Z' },
  { id: 'edit-redo', label: 'Redo', group: 'Document', keywords: ['redo'], shortcut: 'Ctrl Y' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'Document', keywords: ['keys', 'help', 'shortcuts'], shortcut: '?' },
];

const normalized = (value: string) => value.trim().toLocaleLowerCase();

/**
 * Ranked filter. A label prefix beats a word prefix, which beats a keyword hit;
 * ties keep catalogue order so arrow navigation is stable between queries.
 */
export function filterPdfEditorCommands(
  query: string,
  commands: readonly PdfEditorCommand[] = PDF_EDITOR_COMMANDS,
): PdfEditorCommand[] {
  const term = normalized(query);
  if (!term) return [...commands];

  const scored = commands.flatMap((command, index) => {
    const label = command.label.toLocaleLowerCase();
    const words = label.split(/\s+/);
    let score = 0;
    if (label.startsWith(term)) score = 4;
    else if (words.some(word => word.startsWith(term))) score = 3;
    else if (label.includes(term)) score = 2;
    else if (command.keywords.some(keyword => keyword.includes(term))) score = 1;
    return score ? [{ command, score, index }] : [];
  });

  return scored
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(entry => entry.command);
}
