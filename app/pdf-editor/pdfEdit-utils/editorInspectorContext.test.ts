import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isPdfEditorTextSelectionVisible,
  resolvePdfEditorInspectorContext,
} from './editorInspectorContext.ts';
import type { PdfEditorInspectorContext } from './editorInspectorContext.ts';
import type { EditorState, ToolType } from '../pdfEdit-hooks/usePdfEditor';

/**
 * The inspector's whole contract, in one table: which tool is held, what is
 * selected, and which panel the user must get.
 *
 * This is the regression net for the reported defect — returning to Select
 * after editing text left the rail on "Text" with Page Size unreachable —
 * and for the sibling it hid: the same stale text selection shadowed the
 * Sign / Image / Emoji panels their tools exist to open.
 */
const MATRIX: Array<{
  tool: ToolType;
  hasVisibleTextSelection: boolean;
  selectedObjectKind: EditorState['selectedObjectKind'];
  expected: PdfEditorInspectorContext;
  why: string;
}> = [
  // 1. A held tool with its own panel wins, whatever is selected.
  { tool: 'redact', hasVisibleTextSelection: true, selectedObjectKind: 'shape', expected: 'redaction',
    why: 'redaction review is the panel the armed redact tool needs' },
  { tool: 'annotate', hasVisibleTextSelection: true, selectedObjectKind: 'shape', expected: 'annotation',
    why: 'annotation review is the panel the armed annotate tool needs' },
  { tool: 'signature', hasVisibleTextSelection: true, selectedObjectKind: 'image', expected: 'signature',
    why: 'the signature pad must open even if a block was selected earlier' },
  { tool: 'image', hasVisibleTextSelection: true, selectedObjectKind: 'shape', expected: 'image',
    why: 'the image insert control must open even if a block was selected earlier' },
  { tool: 'emoji', hasVisibleTextSelection: true, selectedObjectKind: 'shape', expected: 'emoji',
    why: 'the emoji picker must open even if a block was selected earlier' },

  // 2. A visible text block.
  { tool: 'editText', hasVisibleTextSelection: true, selectedObjectKind: 'none', expected: 'text',
    why: 'the block being edited is what the text styles apply to' },
  { tool: 'editText', hasVisibleTextSelection: true, selectedObjectKind: 'shape', expected: 'text',
    why: 'the text block the user is editing outranks an object that happens to be selected' },

  // 3. An object Fabric really has selected.
  { tool: 'select', hasVisibleTextSelection: false, selectedObjectKind: 'text', expected: 'text',
    why: 'a selected text object shows the text styles' },
  { tool: 'select', hasVisibleTextSelection: false, selectedObjectKind: 'image', expected: 'image',
    why: 'a selected image shows the image panel' },
  { tool: 'select', hasVisibleTextSelection: false, selectedObjectKind: 'shape', expected: 'shape',
    why: 'a selected shape shows the shape panel' },
  { tool: 'text', hasVisibleTextSelection: false, selectedObjectKind: 'text', expected: 'text',
    why: 'the new textbox the text tool creates is selected, and its styles are the panel' },

  // 4. Nothing selected: the document, where Page Size lives.
  { tool: 'select', hasVisibleTextSelection: false, selectedObjectKind: 'none', expected: 'document',
    why: 'the reported case: back on Select with nothing selected' },
  { tool: 'editText', hasVisibleTextSelection: false, selectedObjectKind: 'none', expected: 'document',
    why: 'Edit text with no block chosen is still the document' },
  { tool: 'text', hasVisibleTextSelection: false, selectedObjectKind: 'none', expected: 'document',
    why: 'Add text before the box exists is still the document' },
  { tool: 'highlight', hasVisibleTextSelection: false, selectedObjectKind: 'none', expected: 'document',
    why: 'highlight places a marker and returns to Select' },
  { tool: 'rect', hasVisibleTextSelection: false, selectedObjectKind: 'none', expected: 'document',
    why: 'an armed shape tool has no panel until the drag makes an object' },
  { tool: 'circle', hasVisibleTextSelection: false, selectedObjectKind: 'none', expected: 'document',
    why: 'an armed shape tool has no panel until the drag makes an object' },
  { tool: 'line', hasVisibleTextSelection: false, selectedObjectKind: 'none', expected: 'document',
    why: 'an armed shape tool has no panel until the drag makes an object' },
  { tool: 'arrow', hasVisibleTextSelection: false, selectedObjectKind: 'none', expected: 'document',
    why: 'an armed shape tool has no panel until the drag makes an object' },
];

for (const row of MATRIX) {
  test(`${row.tool} + text:${row.hasVisibleTextSelection} + object:${row.selectedObjectKind} → ${row.expected}`, () => {
    assert.equal(
      resolvePdfEditorInspectorContext({
        activeTool: row.tool,
        hasVisibleTextSelection: row.hasVisibleTextSelection,
        selectedObjectKind: row.selectedObjectKind,
      }),
      row.expected,
      row.why,
    );
  });
}

test('a tool with no panel of its own never hides the selection or the document', () => {
  const panelLess: ToolType[] = ['select', 'editText', 'text', 'highlight', 'rect', 'circle', 'line', 'arrow'];
  const kinds: Array<EditorState['selectedObjectKind']> = ['none', 'text', 'image', 'shape'];
  for (const tool of panelLess) {
    for (const kind of kinds) {
      const expected = kind === 'none' ? 'document' : kind;
      assert.equal(
        resolvePdfEditorInspectorContext({
          activeTool: tool,
          hasVisibleTextSelection: false,
          selectedObjectKind: kind,
        }),
        expected,
        `${tool} with a ${kind} selection`,
      );
    }
  }
});

test('a text block is visible only while Edit text holds its own page', () => {
  assert.equal(
    isPdfEditorTextSelectionVisible({ activeTool: 'editText', selectedTextKey: '2:0', sourcePage: 2 }),
    true,
  );
  assert.equal(
    isPdfEditorTextSelectionVisible({ activeTool: 'editText', selectedTextKey: '10:3', sourcePage: 10 }),
    true,
    'multi-digit source pages parse',
  );
  assert.equal(
    isPdfEditorTextSelectionVisible({ activeTool: 'editText', selectedTextKey: '2:0', sourcePage: 1 }),
    false,
    'a block on another page is not on screen',
  );
  assert.equal(
    isPdfEditorTextSelectionVisible({ activeTool: 'select', selectedTextKey: '2:0', sourcePage: 2 }),
    false,
    'without the overlays the block is not drawn at all',
  );
  assert.equal(
    isPdfEditorTextSelectionVisible({ activeTool: 'signature', selectedTextKey: '2:0', sourcePage: 2 }),
    false,
  );
  assert.equal(
    isPdfEditorTextSelectionVisible({ activeTool: 'editText', selectedTextKey: null, sourcePage: 2 }),
    false,
  );
});

test('a key the editor never wrote cannot select anything', () => {
  for (const key of ['', 'abc', '2', '2:', ':0', '0:0', '00:0', '2:0:1', '-1:0', '1.5:0', ' 1:0', '1: 0', '1:0 ']) {
    assert.equal(
      isPdfEditorTextSelectionVisible({ activeTool: 'editText', selectedTextKey: key, sourcePage: 1 }),
      false,
      `"${key}" must not be treated as a block key`,
    );
  }
  assert.equal(
    isPdfEditorTextSelectionVisible({ activeTool: 'editText', selectedTextKey: '01:0', sourcePage: 1 }),
    true,
    'leading zeros still name a page',
  );
});
