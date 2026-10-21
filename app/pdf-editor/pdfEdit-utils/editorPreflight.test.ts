import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPdfExportImpact,
  isConfirmedExportMode,
  scanPdfDocumentPreflight,
  scanPdfSourceSignals,
} from './editorPreflight.ts';

const decision = (mode: 'structure-preserving' | 'compatibility-render') => ({
  mode,
  preservation: mode === 'structure-preserving' ? 'source-structure' as const : 'visual-and-searchable' as const,
  reason: 'test decision',
});

test('source preflight signals detect encryption, signatures, and tagged structure', () => {
  const source = new TextEncoder().encode('/Encrypt /ByteRange /ByteRange /StructTreeRoot');
  assert.deepEqual(scanPdfSourceSignals(source), {
    hasEncryptionDictionary: true,
    digitalSignatureCount: 2,
    hasStructureTree: true,
  });
});

test('document preflight aggregates interactive and preservation-sensitive features', async () => {
  const report = await scanPdfDocumentPreflight({
    numPages: 2,
    getPage: async (page) => ({
      rotate: page === 2 ? 90 : 0,
      getAnnotations: async () => page === 1
        ? [{ subtype: 'Link' }, { subtype: 'Highlight' }, { subtype: 'Widget', fieldType: 'Sig' }]
        : [],
    }),
    getAttachments: async () => ({ appendix: {} }),
    getOutline: async () => [{ title: 'Introduction', items: [{ title: 'Scope' }] }],
    getPermissions: async () => [4],
    getMetadata: async () => ({ info: { Title: 'Contract' } }),
    getMarkInfo: async () => ({ Marked: true }),
    getFieldObjects: async () => ({ customer: [{ fieldType: 'Tx' }, { fieldType: 'Sig' }] }),
    getJSActions: async () => ({ WillClose: 'app-action' }),
  }, {
    hasEncryptionDictionary: false,
    digitalSignatureCount: 1,
    hasStructureTree: false,
  });

  assert.equal(report.status, 'complete');
  assert.equal(report.pageCount, 2);
  assert.deepEqual(report.features.digitalSignatures, { present: true, count: 1 });
  assert.deepEqual(report.features.forms, { present: true, fieldCount: 2, signatureFieldCount: 1 });
  assert.deepEqual(report.features.annotations, { present: true, count: 1 });
  assert.deepEqual(report.features.links, { present: true, count: 1 });
  assert.deepEqual(report.features.outline, { present: true, itemCount: 2 });
  assert.deepEqual(report.features.attachments, { present: true, count: 1 });
  assert.deepEqual(report.features.encryption, { present: true, restricted: true });
  assert.deepEqual(report.features.taggedContent, { present: true });
  assert.deepEqual(report.features.javascript, { present: true });
  assert.deepEqual(report.features.rotatedPages, { present: true, count: 1 });
});

test('partial preflight remains usable when optional readers or pages fail', async () => {
  const report = await scanPdfDocumentPreflight({
    numPages: 1,
    getPage: async () => { throw new Error('page unavailable'); },
  });

  assert.equal(report.status, 'partial');
  assert.equal(report.features.forms.present, false);
  assert.equal(report.features.annotations.present, false);
  assert.equal(report.warnings.length >= 8, true);
});

test('export impact identifies high-risk compatibility losses and requires matching approval', () => {
  const report = {
    status: 'complete' as const,
    scannedAt: 1,
    pageCount: 1,
    warnings: [],
    features: {
      encryption: { present: true, restricted: true },
      digitalSignatures: { present: true, count: 1 },
      forms: { present: true, fieldCount: 1, signatureFieldCount: 1 },
      annotations: { present: true, count: 1 },
      links: { present: true, count: 1 },
      outline: { present: true, itemCount: 1 },
      attachments: { present: true, count: 1 },
      taggedContent: { present: true },
      metadata: { present: true },
      javascript: { present: true },
      rotatedPages: { present: false, count: 0 },
    },
  };
  const impact = buildPdfExportImpact(report, decision('compatibility-render'));

  assert.equal(impact.requiresConfirmation, true);
  assert.equal(impact.severity, 'critical');
  assert.equal(impact.consequences.some(item => item.id === 'digital-signatures'), true);
  assert.equal(impact.consequences.some(item => item.id === 'attachments'), true);
  assert.equal(isConfirmedExportMode(undefined, impact), false);
  assert.equal(isConfirmedExportMode('structure-preserving', impact), false);
  assert.equal(isConfirmedExportMode('compatibility-render', impact), true);
});

test('compatibility approval can cover a structure export before a retry fallback', () => {
  const impact = buildPdfExportImpact(null, decision('structure-preserving'));
  assert.equal(impact.requiresConfirmation, true);
  assert.equal(impact.severity, 'critical');
  assert.equal(impact.consequences.some(item => item.id === 'preflight-pending'), true);
  assert.equal(isConfirmedExportMode('compatibility-render', impact), true);
});

test('visual text fallback exports without an approval dialog', () => {
  const impact = buildPdfExportImpact(null, decision('compatibility-render'), {
    fallbackReason: 'Replacement text not found in the exported page.',
    visualTextFallback: true,
  });

  assert.equal(impact.requiresConfirmation, false);
  assert.equal(impact.title, 'Edited PDF is ready');
  assert.equal(impact.summary, 'The edited page will be saved to match the preview.');
  assert.equal(impact.confirmLabel, 'Export PDF');
});

test('redaction always forces a critical confirmation that names removal', () => {
  const impact = buildPdfExportImpact(null, decision('structure-preserving'), {
    redactionCount: 2,
  });

  assert.equal(impact.requiresConfirmation, true);
  assert.equal(impact.severity, 'critical');
  assert.equal(impact.title, 'Review redactions before export');
  assert.equal(impact.confirmLabel, 'Export redacted PDF');
  assert.equal(impact.consequences.some(item => item.id === 'redaction'), true);
  assert.match(impact.summary, /proven absent/);
});
