// ─────────────────────────────────────────────────────────────
//  editorInspectorContext.ts
//  What the right rail is describing, right now.
//
//  The rule, in one sentence: the rail follows the instrument the
//  user is holding, then the selection that is really on screen,
//  and with neither it is the document itself — which is where
//  Page Size lives.
//
//  This replaces an inline chain in `page.tsx` whose text-block
//  branch read a key that outlived its tool. Two user-visible
//  failures came from that: leaving Edit text kept a Text panel
//  for a block that was no longer drawn (Page Size became
//  unreachable and nothing on screen explained why), and the same
//  stale key shadowed the Sign / Image / Emoji panels that those
//  tools exist to open.
//
//  Pure and total: state in, context out. The whole matrix has one
//  home here so `editorInspectorContext.test.ts` can pin every
//  combination without a browser — which the inline chain could
//  never be.
// ─────────────────────────────────────────────────────────────

import type { EditorState, ToolType } from '../pdfEdit-hooks/usePdfEditor';

/**
 * The panel families the inspector can show.
 *
 * `page` is the panel's older name for the same document panel; nothing
 * produces it today, and the panel keeps treating both alike.
 */
export type PdfEditorInspectorContext =
  | 'document'
  | 'text'
  | 'image'
  | 'signature'
  | 'emoji'
  | 'shape'
  | 'page'
  | 'redaction'
  | 'annotation';

/**
 * Text-block keys are written by the editor as `<sourcePage>:<index>`.
 * Anything else is not a key the editor wrote, and cannot select a block.
 */
const TEXT_BLOCK_KEY = /^(\d+):(\d+)$/;

/**
 * The page a text-block key names, or `null` when the key names nothing.
 *
 * The digits-only shape is deliberate: a key with a sign, a space, a
 * missing half or an extra colon is refused rather than parsed into a
 * page that was never meant.
 */
function textBlockKeyPage(key: string | null): number | null {
  if (!key) return null;
  const match = TEXT_BLOCK_KEY.exec(key);
  if (!match) return null;
  const page = Number(match[1]);
  return page >= 1 ? page : null;
}

/**
 * Is the selected text block actually on screen?
 *
 * The Edit-text overlays are the only thing that can draw a selected block,
 * and they exist only while that tool is held and only on the page the
 * editor is showing. A block that fails either test is not a selection the
 * user can see, so no panel, status line or style target may describe it.
 */
export function isPdfEditorTextSelectionVisible(input: {
  activeTool: ToolType;
  selectedTextKey: string | null;
  /** The source page on screen — the page the canvas is holding. */
  sourcePage: number;
}): boolean {
  if (input.activeTool !== 'editText') return false;
  return textBlockKeyPage(input.selectedTextKey) === input.sourcePage;
}

/**
 * The context the right rail must show, in precedence order:
 *
 *  1. A held tool that has a panel of its own — Redact, Annotate, Sign,
 *     Insert ▸ Image / Emoji. The instrument is on screen and armed, so its
 *     panel is never shadowed by a selection that belongs to another tool.
 *  2. A visible text-block selection (see above).
 *  3. Whatever Fabric genuinely has selected: the canvas keeps that live,
 *     so a panel here always describes handles the user can see.
 *  4. The document — Page Size and Document Health.
 */
export function resolvePdfEditorInspectorContext(input: {
  activeTool: ToolType;
  hasVisibleTextSelection: boolean;
  selectedObjectKind: EditorState['selectedObjectKind'];
}): PdfEditorInspectorContext {
  switch (input.activeTool) {
    case 'redact': return 'redaction';
    case 'annotate': return 'annotation';
    case 'signature': return 'signature';
    case 'image': return 'image';
    case 'emoji': return 'emoji';
    default: break;
  }
  if (input.hasVisibleTextSelection) return 'text';
  if (input.selectedObjectKind !== 'none') return input.selectedObjectKind;
  return 'document';
}
