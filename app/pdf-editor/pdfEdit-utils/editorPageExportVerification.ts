/**
 * Phase 3B safety gate: proves a page-plan export actually produced the pages
 * the user asked for, by reopening the output and comparing it to the source.
 *
 * Page operations are uniquely dangerous because a wrong result still looks like
 * a valid PDF. A dropped or misordered page does not throw, it just quietly ships
 * the wrong document. So ordering is verified by matching each output page's text
 * back to the source page the plan claimed to place there, rather than trusting
 * the exporter's own bookkeeping.
 */

import {
  expectedPdfEditorPagePlanOrder,
  expectedPdfEditorPagePlanRotations,
} from './editorPageExport.ts';
import type { PdfEditorPageExportDecision } from './editorPageExport.ts';
import { inspectPdfForExportVerification, compareDocumentMetadata } from './editorExportVerification.ts';
import type { PdfVerificationSnapshot } from './editorExportVerification.ts';
import { expectedPdfEditorOutputPageCount } from './editorPageModel.ts';
import type { PdfEditorPagePlan } from './editorPageModel.ts';

export type PdfPagePlanVerificationCheck = {
  id: string;
  status: 'passed' | 'failed' | 'allowed-loss';
  detail: string;
};

export type PdfPagePlanVerification = {
  ok: boolean;
  strategy: PdfEditorPageExportDecision['strategy'];
  verifiedAt: number;
  checks: PdfPagePlanVerificationCheck[];
  failures: string[];
  allowedLosses: readonly string[];
  output: PdfVerificationSnapshot | null;
};

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function verifyPdfEditorPagePlanSnapshots(options: {
  plan: PdfEditorPagePlan;
  decision: PdfEditorPageExportDecision;
  source: PdfVerificationSnapshot;
  output: PdfVerificationSnapshot;
  bytesEqual?: boolean;
}): PdfPagePlanVerification {
  const { plan, decision, source, output } = options;
  const checks: PdfPagePlanVerificationCheck[] = [];
  const failures: string[] = [];
  const pass = (id: string, detail: string) => checks.push({ id, status: 'passed', detail });
  const fail = (id: string, detail: string) => {
    checks.push({ id, status: 'failed', detail });
    failures.push(detail);
  };

  if (output.readers.pdfjs && output.readers.pdfLib) {
    pass('reopen', 'PDF.js and pdf-lib reopened the page-plan output.');
  } else {
    fail('reopen', 'The exported PDF did not reopen in both verification readers.');
  }

  // The plan was built against a specific source document; if that no longer
  // matches, every positional check below would be meaningless.
  if (source.pageCount === plan.sourcePageCount) {
    pass('source-identity', `Source document still has the planned ${plan.sourcePageCount} pages.`);
  } else {
    fail(
      'source-identity',
      `Plan targets ${plan.sourcePageCount} source pages but the source has ${source.pageCount}.`,
    );
  }

  const expectedCount = expectedPdfEditorOutputPageCount(plan);
  if (output.pageCount === expectedCount) {
    pass('page-count', `Output has the planned ${expectedCount} pages.`);
  } else {
    fail('page-count', `Planned ${expectedCount} pages, found ${output.pageCount}.`);
  }

  const order = expectedPdfEditorPagePlanOrder(plan);
  order.forEach((sourcePage, index) => {
    const expected = normalizeText(source.pageText[sourcePage - 1] ?? '');
    // A page with no extractable text cannot prove its own position; scanned or
    // image-only pages are legitimately blank here, so they are not failures.
    if (!expected) {
      checks.push({
        id: `order-${index + 1}`,
        status: 'allowed-loss',
        detail: `Output page ${index + 1} has no source text to verify ordering against.`,
      });
      return;
    }
    const actual = normalizeText(output.pageText[index] ?? '');
    if (actual.includes(expected)) {
      pass(`order-${index + 1}`, `Output page ${index + 1} carries source page ${sourcePage}.`);
    } else {
      fail(
        `order-${index + 1}`,
        `Output page ${index + 1} does not contain source page ${sourcePage} text.`,
      );
    }
  });

  const expectedRotations = expectedPdfEditorPagePlanRotations(plan, source.pageRotations);
  const actualRotations = output.pageRotations.slice(0, expectedRotations.length);
  if (JSON.stringify(actualRotations) === JSON.stringify(expectedRotations)) {
    pass('rotation', 'Every output page reopened at its planned rotation.');
  } else {
    fail(
      'rotation',
      `Planned rotations ${expectedRotations.join(',')} but found ${actualRotations.join(',')}.`,
    );
  }

  if (decision.strategy === 'byte-preserving') {
    if (options.bytesEqual) pass('exact-bytes', 'Untouched plan returned the source bytes exactly.');
    else fail('exact-bytes', 'An untouched page plan changed the source bytes.');
  }

  // Only strategies that claim structure preservation are held to it. A rebuild
  // declares its losses up front, so charging it for them would be dishonest.
  if (decision.strategy !== 'page-rebuild') {
    const missingFields = source.formFieldNames.filter(name => !output.formFieldNames.includes(name));
    if (!missingFields.length) pass('form-field-identity', 'Form field names were retained.');
    else fail('form-field-identity', `Form fields were removed or renamed: ${missingFields.join(', ')}.`);

    const metadata = compareDocumentMetadata(source.metadata, output.metadata);
    if (metadata.passed) pass('metadata', 'Document metadata was retained.');
    else metadata.problems.forEach(({ key, sourceValue, outputValue, toolOwned }) => {
      checks.push({
        id: `metadata-${key}`,
        status: 'allowed-loss',
        detail: toolOwned
          ? `Document metadata field ${key} was refreshed by the saving tool.`
          : `Document metadata field ${key} changed or was removed (source: "${sourceValue}", exported: "${outputValue}").`,
      });
    });
  } else {
    decision.declaredLosses.forEach(detail => checks.push({
      id: `allowed-${detail}`,
      status: 'allowed-loss',
      detail,
    }));
  }

  return {
    ok: failures.length === 0,
    strategy: decision.strategy,
    verifiedAt: Date.now(),
    checks,
    failures,
    allowedLosses: decision.declaredLosses,
    output,
  };
}

export async function verifyGeneratedPdfEditorPagePlan(options: {
  plan: PdfEditorPagePlan;
  decision: PdfEditorPageExportDecision;
  sourceBytes: ArrayBuffer | Uint8Array;
  outputBytes: ArrayBuffer | Uint8Array;
}): Promise<PdfPagePlanVerification> {
  try {
    const [source, output] = await Promise.all([
      inspectPdfForExportVerification(options.sourceBytes),
      inspectPdfForExportVerification(options.outputBytes),
    ]);
    const sourceBytes = options.sourceBytes instanceof Uint8Array
      ? options.sourceBytes
      : new Uint8Array(options.sourceBytes);
    const outputBytes = options.outputBytes instanceof Uint8Array
      ? options.outputBytes
      : new Uint8Array(options.outputBytes);
    const bytesEqual = sourceBytes.byteLength === outputBytes.byteLength
      && sourceBytes.every((value, index) => value === outputBytes[index]);

    return verifyPdfEditorPagePlanSnapshots({
      plan: options.plan,
      decision: options.decision,
      source,
      output,
      bytesEqual,
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'The page-plan export could not be verified.';
    return {
      ok: false,
      strategy: options.decision.strategy,
      verifiedAt: Date.now(),
      checks: [{ id: 'reopen', status: 'failed', detail: message }],
      failures: [message],
      allowedLosses: options.decision.declaredLosses,
      output: null,
    };
  }
}
