import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PDF_EDITOR_COMMANDS,
  filterPdfEditorCommands,
} from './editorCommandPalette.ts';

test('empty palette query keeps catalogue order', () => {
  assert.deepEqual(
    filterPdfEditorCommands('').map(command => command.id),
    PDF_EDITOR_COMMANDS.map(command => command.id),
  );
});

test('palette ranking prefers label prefixes and then keywords', () => {
  const fit = filterPdfEditorCommands('fit').map(command => command.id);
  assert.deepEqual(fit.slice(0, 3), ['view-fit-page', 'view-fit-width', 'view-actual']);

  const text = filterPdfEditorCommands('text').map(command => command.id);
  assert.ok(text.includes('tool-editText'));
  assert.ok(text.includes('tool-text'));

  const unknown = filterPdfEditorCommands('definitely-not-a-command');
  assert.deepEqual(unknown, []);
});

test('palette query is case and whitespace insensitive', () => {
  assert.deepEqual(
    filterPdfEditorCommands('  DOWNLOAD  ').map(command => command.id),
    ['document-export'],
  );
});
