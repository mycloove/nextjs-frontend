import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessTextRendering,
  bidiReasonForCodePoint,
  canRenderTextFaithfully,
  classifyCodePointCapability,
  decideTextRenderingRoute,
  describeTextRenderingRequirement,
} from './editorTextShaping.ts';

test('plain Latin text needs no font embedding and no shaping', () => {
  const requirement = assessTextRendering('Invoice total: $1,240.00');

  assert.equal(requirement.capability, 'standard-font');
  assert.equal(requirement.needsFontEmbedding, false);
  assert.equal(requirement.needsShaping, false);
  assert.deepEqual(requirement.blockers, []);
  assert.equal(decideTextRenderingRoute(requirement), 'built-in-font');
});

test('Latin-1 accented text stays on the built-in fonts', () => {
  // WinAnsi covers these, so embedding a font would be unnecessary work.
  const requirement = assessTextRendering('café Ångström naïve');

  assert.equal(requirement.capability, 'standard-font');
  assert.equal(decideTextRenderingRoute(requirement), 'built-in-font');
});

test('REGRESSION: Bengali is exported, not refused', () => {
  // This module used to refuse Bengali on the stated grounds that drawText
  // "applies no GSUB". That was measured and is false: pdf-lib encodes "কি" as
  // glyphs [55, 20] — the vowel sign placed *before* the consonant, which is
  // correct Bengali. Refusing it denied a working feature to Bangla users.
  // See docs/pdf-editor-shaping-findings.md.
  const requirement = assessTextRendering('কি');

  assert.equal(requirement.capability, 'embeddable-shaped');
  assert.equal(requirement.needsFontEmbedding, true);
  assert.equal(requirement.needsShaping, true);
  assert.deepEqual(requirement.blockers, []);
  assert.equal(decideTextRenderingRoute(requirement), 'embed-and-shape');
});

test('REGRESSION: a Bengali conjunct is exported, not refused', () => {
  // ক + ্ (hasant) + ষ fuse into one glyph. Measured: pdf-lib emits a single
  // glyph id for all three code points, which only GSUB can produce.
  const requirement = assessTextRendering('ক\u09CDষ');

  assert.equal(requirement.capability, 'embeddable-shaped');
  assert.deepEqual(requirement.blockers, []);
  assert.equal(decideTextRenderingRoute(requirement), 'embed-and-shape');
});

test('mixed Latin and Bengali is exported as one shaped run', () => {
  // The common real case: a Bangla name in an otherwise English form.
  const requirement = assessTextRendering('Name: রহিম');

  assert.equal(requirement.capability, 'embeddable-shaped');
  assert.equal(decideTextRenderingRoute(requirement), 'embed-and-shape');
  assert.equal(canRenderTextFaithfully('Name: রহিম'), true);
});

test('other Indic and South-East Asian scripts are shaped, not refused', () => {
  for (const sample of ['नमस्ते', 'สวัสดี', 'வணக்கம்', 'សូស្តី', 'ಕನ್ನಡ', 'සිංහල']) {
    const requirement = assessTextRendering(sample);
    assert.equal(requirement.needsShaping, true, sample);
    assert.equal(decideTextRenderingRoute(requirement), 'embed-and-shape', sample);
  }
});

test('right-to-left scripts are still refused, because bidi is not implemented', () => {
  // Not a font problem: fontkit shapes a single run but does not implement the
  // Unicode Bidi Algorithm, which is what orders mixed LTR/RTL runs. Embedding
  // a font would produce reversed words that look deliberate.
  for (const sample of ['שלום', 'مرحبا']) {
    const requirement = assessTextRendering(sample);
    assert.equal(requirement.capability, 'requires-bidi', sample);
    assert.equal(decideTextRenderingRoute(requirement), 'refuse-unsupported-script', sample);
    assert.ok(requirement.blockers.length > 0, sample);
  }
});

test('one RTL word poisons an otherwise Latin paragraph', () => {
  // Worst-case-wins. Silently dropping the reversed word would hand back a
  // document that looks complete.
  const requirement = assessTextRendering('Name: שלום (ID 42)');

  assert.equal(requirement.capability, 'requires-bidi');
  assert.equal(decideTextRenderingRoute(requirement), 'refuse-unsupported-script');
});

test('bidi control characters are refused even among Latin text', () => {
  for (const control of ['\u200E', '\u200F', '\u202E', '\u2066']) {
    const requirement = assessTextRendering(`a${control}b`);
    assert.equal(
      decideTextRenderingRoute(requirement),
      'refuse-unsupported-script',
      `U+${control.codePointAt(0)?.toString(16).toUpperCase()} should be refused`,
    );
  }
});

test('zero-width joiners are shaping controls, not bidi controls', () => {
  // ZWJ/ZWNJ make or break Indic conjuncts and are consumed by the shaper, so
  // they must not be lumped in with the direction overrides above.
  for (const control of ['\u200B', '\u200C', '\u200D']) {
    const requirement = assessTextRendering(`ক${control}ষ`);
    assert.equal(requirement.needsShaping, true);
    assert.deepEqual(requirement.blockers, []);
  }
});

test('simple scripts are embedded without shaping', () => {
  for (const sample of ['Привет мир', 'Καλημέρα', 'ႠႡჰ']) {
    const requirement = assessTextRendering(sample);
    assert.equal(requirement.capability, 'embeddable-simple', sample);
    assert.equal(requirement.needsShaping, false, sample);
    assert.equal(decideTextRenderingRoute(requirement), 'embed-unicode-font', sample);
  }
});

test('CJK is embedded without shaping', () => {
  for (const sample of ['合同書', 'ひらがな', 'カタカナ']) {
    const requirement = assessTextRendering(sample);
    assert.equal(requirement.capability, 'embeddable-simple');
    assert.equal(decideTextRenderingRoute(requirement), 'embed-unicode-font');
  }
});

test('precomposed Hangul is simple but Hangul Jamo needs shaping', () => {
  // This pair is why the narrow Jamo range is checked before the broad block.
  const precomposed = assessTextRendering('한국어');
  assert.equal(precomposed.capability, 'embeddable-simple');

  const jamo = assessTextRendering('\u1100\u1161');
  assert.equal(jamo.capability, 'embeddable-shaped');
  assert.equal(decideTextRenderingRoute(jamo), 'embed-and-shape');
});

test('combining marks need shaping so GPOS can position them', () => {
  const requirement = assessTextRendering('e\u0301');

  assert.equal(requirement.needsShaping, true);
  assert.deepEqual(requirement.blockers, []);
});

test('unclassified code points are refused rather than guessed at', () => {
  // Yi Syllables are unclassified here. The safe answer is refusal: guessing
  // wrong ships malformed text that looks fine.
  assert.equal(classifyCodePointCapability(0xa000), 'requires-bidi');

  const requirement = assessTextRendering('\uA000');
  assert.equal(decideTextRenderingRoute(requirement), 'refuse-unsupported-script');
});

test('blocker indices are counted in code points, not UTF-16 units', () => {
  // An astral emoji is two UTF-16 units. Using `.length` would drift the
  // reported position of every later character.
  const requirement = assessTextRendering('a\u{1F600}\u202E');

  assert.equal(requirement.blockers.length, 1);
  assert.equal(requirement.blockers[0].index, 2);
});

test('empty text is trivially renderable', () => {
  const requirement = assessTextRendering('');

  assert.equal(requirement.capability, 'standard-font');
  assert.deepEqual(requirement.blockers, []);
  assert.equal(canRenderTextFaithfully(''), true);
});

test('the refusal message names the script and the reason', () => {
  // "Export failed" is unactionable. The user needs to know what broke and why.
  const message = describeTextRenderingRequirement(assessTextRendering('שלום'));

  assert.match(message, /Hebrew/);
  assert.match(message, /bidirectional/);
  assert.match(message, /not applied/);
});

test('the shaped message promises OpenType positioning', () => {
  const message = describeTextRenderingRequirement(assessTextRendering('রহিম'));

  assert.match(message, /shaped/);
  assert.doesNotMatch(message, /not applied/);
});

test('bidiReasonForCodePoint only fires for genuine bidi ranges', () => {
  assert.equal(bidiReasonForCodePoint(0x0995), undefined, 'Bengali is not a bidi problem');
  assert.ok(bidiReasonForCodePoint(0x05D0), 'Hebrew is a bidi problem');
});

test('canRenderTextFaithfully separates faithful output from refusal', () => {
  assert.equal(canRenderTextFaithfully('Contract v2'), true);
  assert.equal(canRenderTextFaithfully('Привет'), true, 'embeddable text is faithful');
  assert.equal(canRenderTextFaithfully('রহিম'), true, 'shaped text is faithful');
  assert.equal(canRenderTextFaithfully('שלום'), false, 'RTL cannot be placed');
});
