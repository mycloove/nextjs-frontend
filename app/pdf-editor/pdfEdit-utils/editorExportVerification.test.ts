import assert from 'node:assert/strict';
import test from 'node:test';

import type { PdfVerificationSnapshot } from './editorExportVerification.ts';
import { verifyPdfExportSnapshots } from './editorExportVerification.ts';

function snapshot(overrides: Partial<PdfVerificationSnapshot> = {}): PdfVerificationSnapshot {
  return {
    byteLength: 100,
    pageCount: 2,
    pageText: ['Contract page one', 'Contract page two'],
    pageRotations: [0, 90],
    metadata: { Title: 'Golden contract', Author: 'SmilePDF' },
    formFieldNames: ['customer.name'],
    readers: { pdfjs: true, pdfLib: true },
    preflight: {
      status: 'complete', scannedAt: 1, pageCount: 2, warnings: [],
      features: {
        encryption: { present: false, restricted: false },
        digitalSignatures: { present: true, count: 1 },
        forms: { present: true, fieldCount: 2, signatureFieldCount: 1 },
        annotations: { present: true, count: 1 },
        links: { present: true, count: 1 },
        outline: { present: true, itemCount: 2 },
        attachments: { present: true, count: 1 },
        taggedContent: { present: true },
        metadata: { present: true },
        javascript: { present: false },
        rotatedPages: { present: true, count: 1 },
      },
    },
    ...overrides,
  };
}

test('structure-preserving verification locks retained document structure', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot(),
    output: snapshot({ byteLength: 180 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.allowedLosses.length, 0);
  assert.equal(result.checks.some(check => check.id === 'attachments' && check.status === 'passed'), true);
});

test('structure-preserving verification ignores reader-derived PDF version normalization', () => {
  const source = snapshot({
    metadata: {
      Title: 'Golden contract',
      Author: 'SmilePDF',
      PDFFormatVersion: '1.4',
      IsLinearized: 'false',
    },
  });
  const output = snapshot({
    metadata: {
      Title: 'Golden contract',
      Author: 'SmilePDF',
      PDFFormatVersion: '1.7',
      IsLinearized: 'true',
    },
  });

  const result = verifyPdfExportSnapshots({ mode: 'structure-preserving', source, output });

  assert.equal(result.ok, true);
  assert.equal(result.checks.some(check => check.id === 'metadata' && check.status === 'passed'), true);
});

test('structure-preserving verification discloses rather than blocks a re-encoded metadata field', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ metadata: { Title: 'Golden contract', Author: 'SmilePDF' } }),
    output: snapshot({ metadata: { Title: 'Golden contract' } }),
  });

  // Metadata is not page content: a re-encoded Info field is disclosed as an
  // allowed loss so the user keeps their edited document, and the content
  // checks (pages, text, structure) remain the corruption gate.
  assert.equal(result.ok, true);
  assert.equal(result.checks.some(check => check.id === 'metadata-Author' && check.status === 'allowed-loss'), true);
  assert.equal(result.allowedLosses.includes('document metadata field Author'), true);
});

test('structure-preserving verification treats save-tool metadata churn as an expected loss', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ metadata: { Title: 'Golden contract', Author: 'SmilePDF', Producer: 'Original App', ModDate: 'D:20200101000000Z' } }),
    output: snapshot({ metadata: { Title: 'Golden contract', Author: 'SmilePDF', Producer: 'SmilePDF Editor', ModDate: 'D:20260827000000Z' } }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.checks.some(check => check.id === 'metadata-Producer' && check.status === 'allowed-loss'), true);
  assert.equal(result.checks.some(check => check.id === 'metadata-ModDate' && check.status === 'allowed-loss'), true);
  // Whitespace-only re-encoding is not a change at all.
  const reencoded = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ metadata: { Title: 'Golden  contract', Author: ' SmilePDF ' } }),
    output: snapshot({ metadata: { Title: 'Golden contract', Author: 'SmilePDF' } }),
  });
  assert.equal(reencoded.ok, true);
  assert.equal(reencoded.checks.some(check => check.id === 'metadata' && check.status === 'passed'), true);
});

test('structure-preserving verification blocks a contract-violating output', () => {
  const output = snapshot();
  output.preflight = structuredClone(output.preflight);
  output.preflight.features.links = { present: false, count: 0 };
  const result = verifyPdfExportSnapshots({ mode: 'structure-preserving', source: snapshot(), output });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(' '), /links contract failed/);
});

test('structure-preserving verification locks signature markers and form field identity', () => {
  const output = snapshot({ formFieldNames: ['replacement.name'] });
  output.preflight = structuredClone(output.preflight);
  output.preflight.features.digitalSignatures = { present: false, count: 0 };
  const result = verifyPdfExportSnapshots({ mode: 'structure-preserving', source: snapshot(), output });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(' '), /digital-signature markers contract failed/);
  assert.match(result.failures.join(' '), /customer\.name/);
});

test('compatibility verification permits declared structural loss but still requires readable pages and text', () => {
  const output = snapshot({ pageRotations: [0, 0], metadata: {}, formFieldNames: [] });
  output.preflight = structuredClone(output.preflight);
  output.preflight.features.forms = { present: false, fieldCount: 0, signatureFieldCount: 0 };
  output.preflight.features.links = { present: false, count: 0 };
  output.preflight.features.outline = { present: false, itemCount: 0 };
  output.preflight.features.attachments = { present: false, count: 0 };
  output.preflight.features.taggedContent = { present: false };
  const result = verifyPdfExportSnapshots({ mode: 'compatibility-render', source: snapshot(), output });
  assert.equal(result.ok, true);
  assert.equal(result.allowedLosses.includes('form fields'), true);
  assert.equal(result.checks.some(check => check.status === 'allowed-loss'), true);
});

test('visual text fallback permits flattened edited pages without pretending text stayed searchable', () => {
  const output = snapshot({
    pageText: ['', 'Contract page two'],
    pageRotations: [0, 0],
    metadata: {},
    formFieldNames: [],
  });
  output.preflight = structuredClone(output.preflight);
  output.preflight.features.forms = { present: false, fieldCount: 0, signatureFieldCount: 0 };
  output.preflight.features.links = { present: false, count: 0 };
  output.preflight.features.outline = { present: false, itemCount: 0 };
  output.preflight.features.attachments = { present: false, count: 0 };
  output.preflight.features.taggedContent = { present: false };

  const result = verifyPdfExportSnapshots({
    mode: 'compatibility-render',
    source: snapshot(),
    output,
    visualTextFallback: { flattenedTextPages: [1] },
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.allowedLosses.includes('searchable source text on visually flattened edited pages'),
    true,
  );
  assert.equal(
    result.checks.some(check => check.id === 'visual-text-fallback-1' && check.status === 'passed'),
    true,
  );
});

test('byte-preserving verification requires exact source bytes', () => {
  const failed = verifyPdfExportSnapshots({
    mode: 'byte-preserving', source: snapshot(), output: snapshot(), bytesEqual: false,
  });
  assert.equal(failed.ok, false);
  assert.match(failed.failures.join(' '), /changed the source bytes/);
});

test('structural text verification checks replacement and removal without requiring old full-page text', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ pageText: ['Contract Original clause', 'Contract page two'] }),
    output: snapshot({ pageText: ['Contract Replacement clause', 'Contract page two'] }),
    textReplacements: [{ page: 1, originalText: 'Original', replacementText: 'Replacement' }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.checks.some(check => check.id === 'removed-text-1' && check.status === 'passed'), true);
});

test('structural text verification fails when cover-and-retype leaves original text extractable', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot(),
    output: snapshot({ pageText: ['Contract page one Replacement', 'Contract page two'] }),
    textReplacements: [{ page: 1, originalText: 'page one', replacementText: 'Replacement' }],
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(' '), /still extractable/);
});

test('structural text verification permits an untouched duplicate when one occurrence was removed', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ pageText: ['Repeat clause Repeat clause', 'Contract page two'] }),
    output: snapshot({ pageText: ['Replacement clause Repeat clause', 'Contract page two'] }),
    textReplacements: [{ page: 1, originalText: 'Repeat', replacementText: 'Replacement' }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.checks.some(check => check.id === 'removed-text-1' && check.status === 'passed'), true);
});

test('structural text verification allows style-only edits that re-author the identical text', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ pageText: ['Contract page one', 'Contract page two'] }),
    output: snapshot({ pageText: ['Contract page one', 'Contract page two'] }),
    textReplacements: [{ page: 1, originalText: 'page one', replacementText: 'page one' }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.checks.some(check => check.id === 'removed-text-1' && check.status === 'passed'), true);
  assert.equal(result.checks.some(check => check.id === 'edited-text-1' && check.status === 'passed'), true);
});

test('structural text verification allows additive edits that keep the original as a substring', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ pageText: ['Invoice Total due', 'Contract page two'] }),
    output: snapshot({ pageText: ['Invoice Total: 500 due', 'Contract page two'] }),
    textReplacements: [{ page: 1, originalText: 'Total', replacementText: 'Total: 500' }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.checks.some(check => check.id === 'removed-text-1' && check.status === 'passed'), true);
});

test('structural text verification allows multiple identical style-only edits on one page', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ pageText: ['Name Name Name', 'Contract page two'] }),
    output: snapshot({ pageText: ['Name Name Name', 'Contract page two'] }),
    textReplacements: [
      { page: 1, originalText: 'Name', replacementText: 'Name' },
      { page: 1, originalText: 'Name', replacementText: 'Name' },
      { page: 1, originalText: 'Name', replacementText: 'Name' },
    ],
  });

  assert.equal(result.ok, true);
});

test('structural text verification still fails a cover-and-retype leftover on a style-only page', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ pageText: ['Secret clause', 'Contract page two'] }),
    output: snapshot({ pageText: ['Secret clause Public', 'Contract page two'] }),
    textReplacements: [{ page: 1, originalText: 'Secret', replacementText: 'Public' }],
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join(' '), /still extractable/);
});

test('added vector text is required to be extractable after reopening', () => {
  const withText = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot(),
    output: snapshot({ pageText: ['Contract page one New note', 'Contract page two'] }),
    addedText: [{ page: 1, text: 'New note' }],
  });
  assert.equal(withText.ok, true);
  assert.equal(withText.checks.some(check => check.id === 'added-text-1' && check.status === 'passed'), true);

  const withoutText = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot(),
    output: snapshot(),
    addedText: [{ page: 1, text: 'Missing note' }],
  });
  assert.equal(withoutText.ok, false);
  assert.ok(withoutText.failures.some(failure => failure.includes('Added text on page 1')));
});
