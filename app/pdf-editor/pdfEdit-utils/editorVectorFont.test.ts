import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { resolvePdfEditorFeatureFlags } from './editorFeatureFlags.ts';
import {
  PDF_EDITOR_VECTOR_FONT_ROLES,
  createPdfEditorVectorFontSet,
} from './editorVectorFont.ts';

const fonts = {
  'latin-regular': readFileSync(new URL('../../../public/fonts/pdf-editor/LiberationSans-Regular.ttf', import.meta.url)),
  'latin-bold': readFileSync(new URL('../../../public/fonts/pdf-editor/LiberationSans-Bold.ttf', import.meta.url)),
  'latin-italic': readFileSync(new URL('../../../public/fonts/pdf-editor/LiberationSans-Italic.ttf', import.meta.url)),
  'latin-boldItalic': readFileSync(new URL('../../../public/fonts/pdf-editor/LiberationSans-BoldItalic.ttf', import.meta.url)),
  'bengali-regular': readFileSync(new URL('../../../public/fonts/pdf-editor/NotoSansBengali-Regular.ttf', import.meta.url)),
  'bengali-bold': readFileSync(new URL('../../../public/fonts/pdf-editor/NotoSansBengali-Bold.ttf', import.meta.url)),
};

test('every role the planner can request has a shipped font file', () => {
  assert.deepEqual([...PDF_EDITOR_VECTOR_FONT_ROLES].sort(), [
    'bengali-bold',
    'bengali-regular',
    'latin-bold',
    'latin-boldItalic',
    'latin-italic',
    'latin-regular',
  ]);
});

test('coverage is answered per code point against the exact embedded font', () => {
  const set = createPdfEditorVectorFontSet(fonts);
  assert.deepEqual(set.missingRoles, []);

  assert.equal(set.covers('latin-regular', 'Hello — “quotes” (ID 42)'), true);
  assert.equal(set.covers('bengali-regular', 'বাংলা কি ক্ষ'), true);
  assert.equal(set.covers('bengali-regular', 'Name: বাংলা (ID 42)'), true);
  assert.equal(set.covers('bengali-bold', 'বাংলা'), true);
  // Invisible shaping controls do not need a visible glyph in every face.
  assert.equal(set.covers('latin-regular', 'Hi\u200d'), true);
  assert.equal(set.covers('bengali-regular', 'বাংলা\u200cকি'), true);

  // Wrong family: the blocker that stops a silent .notdef.
  assert.equal(set.covers('latin-regular', 'বাংলা'), false);
  assert.equal(set.covers('bengali-regular', 'नमस्ते'), false);
  assert.equal(set.covers('bengali-regular', 'Hi 😀'), false);
});

test('the vector export flag fails safe and can be switched off for rollback', () => {
  assert.equal(resolvePdfEditorFeatureFlags({}).vectorCanvasExport, true);
  assert.equal(resolvePdfEditorFeatureFlags({
    NEXT_PUBLIC_PDF_EDITOR_VECTOR_CANVAS_EXPORT: 'off',
  }).vectorCanvasExport, false);
  assert.equal(resolvePdfEditorFeatureFlags({
    NEXT_PUBLIC_PDF_EDITOR_VECTOR_CANVAS_EXPORT: 'not-a-recognised-value',
  }).vectorCanvasExport, true);
});

test('a missing role refuses coverage instead of throwing', () => {
  const set = createPdfEditorVectorFontSet({ 'latin-regular': fonts['latin-regular'] });
  assert.equal(set.covers('latin-regular', 'Hello'), true);
  assert.equal(set.covers('bengali-regular', 'বাংলা'), false);
  assert.equal(set.missingRoles.includes('bengali-regular'), true);
});
