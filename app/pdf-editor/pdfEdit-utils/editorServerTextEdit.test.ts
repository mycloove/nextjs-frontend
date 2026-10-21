import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyServerTextEdits,
  buildServerTextEditConsentImpact,
  classifyServerTextEditConsent,
  collectServerTextEditFailures,
  collectServerTextEditReportDefects,
  describeServerTextEditDisclosures,
  describeServerTextEditFailure,
  isServerTextEditTrustworthy,
  mergeServerTextEditConsent,
  NON_DESTRUCTIVE_REDACTION_MODE,
  VISIBLE_REDACTION_MODE,
  parseServerTextEditReport,
  SERVER_TEXT_EDIT_ENDPOINT,
  serverTextEditConsentFor,
  toServerTextEditRequest,
  UNKNOWN_SOURCE_TEXT_COLOR,
  type ServerTextEditReport,
  type ServerTextEditRequest,
  type ServerTextEditTransport,
} from './editorServerTextEdit.ts';
import type { PdfEditorTextMutation } from './editorExport.ts';

const SAMPLE_PDF_BASE64 = Buffer.from('%PDF-1.7\n%%EOF\n').toString('base64');
const SAMPLE_PDF_SIZE = 15;
const SAMPLE_PDF_SHA256 = '1e7313ace78f0fb481a486939b4885902663102818090805515553d84e0bbfd3';

function edit(overrides: Partial<ServerTextEditRequest> = {}): ServerTextEditRequest {
  return {
    id: 'edit-1',
    page: 1,
    x: 10,
    y: 20,
    width: 200,
    height: 14,
    originalText: 'Original',
    newText: 'Replacement',
    fontSize: 12,
    lineHeight: 1.3,
    color: '#000000',
    align: 'left',
    bold: false,
    italic: false,
    ...overrides,
  };
}

function report(overrides: Partial<ServerTextEditReport> = {}): ServerTextEditReport {
  return {
    contractVersion: 1,
    transactionMode: 'atomic',
    status: 'verified',
    summary: 'All 1 text edit(s) applied.',
    outcomes: [{
      id: 'edit-1',
      page: 1,
      status: 'applied',
      originalRemoved: true,
      replacementPresent: true,
      // Part of the trust contract, not decoration: the engine reports which
      // redaction mode ran, and only the least destructive one is acceptable.
      redactionMode: NON_DESTRUCTIVE_REDACTION_MODE,
    }],
    pdf: SAMPLE_PDF_BASE64,
    pdfSize: SAMPLE_PDF_SIZE,
    pdfSha256: SAMPLE_PDF_SHA256,
    engine: { committed: true, editsRequested: 1, transactionMode: 'atomic' },
    ...overrides,
  };
}

/** Transport that answers with a fixed body, recording what it was handed. */
function stubTransport(body: unknown, calls: { endpoint?: string; form?: FormData } = {}) {
  const transport: ServerTextEditTransport = async (endpoint, form) => {
    calls.endpoint = endpoint;
    calls.form = form;
    return { status: 200, json: async () => body };
  };
  return transport;
}

test('a verified report with every edit applied is trustworthy', () => {
  assert.equal(isServerTextEditTrustworthy(report()), true);
});

test('the visible redaction mode is accepted only for an edit marked as a redaction', () => {
  // A scanned page keeps its words in an image under the OCR layer. A true
  // redaction therefore runs in this mode; an ordinary text edit in the same
  // mode would have destroyed art nobody asked to lose.
  const visible = report({
    outcomes: [{
      id: 'text-1',
      page: 1,
      status: 'applied',
      originalRemoved: true,
      replacementPresent: true,
      redactionMode: VISIBLE_REDACTION_MODE,
    }],
  });

  assert.equal(isServerTextEditTrustworthy(visible), false);
  assert.equal(
    isServerTextEditTrustworthy(visible, { redactionEditIds: new Set(['text-1']) }),
    true,
  );
  assert.equal(
    isServerTextEditTrustworthy(visible, { redactionEditIds: new Set(['text-2']) }),
    false,
    'an ordinary edit must not inherit the redaction concession',
  );

  assert.deepEqual(
    collectServerTextEditReportDefects(visible, { redactionEditIds: new Set(['text-1']) }),
    [],
  );
  assert.match(collectServerTextEditReportDefects(visible).join(' '), /redactionMode/);

  const disclosures = describeServerTextEditDisclosures(
    visible,
    { redactionEditIds: new Set(['text-1']) },
  ).join(' ');
  assert.match(disclosures, /images and vector art/i);
});

test('partial is never trustworthy', () => {
  const partial = report({
    status: 'partial',
    outcomes: [
      { id: 'a', page: 1, status: 'applied', originalRemoved: true, replacementPresent: true },
      { id: 'b', page: 2, status: 'refused', reason: 'No extractable text in region.' },
    ],
    engine: { committed: false, editsRequested: 2, transactionMode: 'atomic' },
  });
  assert.equal(isServerTextEditTrustworthy(partial), false);
  assert.deepEqual(
    collectServerTextEditFailures(partial).map((item) => item.id),
    ['b'],
  );
});

test('a verified status cannot launder an unverified edit', () => {
  // Defence in depth: if the engine ever mislabels the roll-up, the per-edit
  // outcomes still veto the download.
  const inconsistent = report({
    status: 'verified',
    outcomes: [{ id: 'edit-1', page: 1, status: 'unverified' }],
  });
  assert.equal(isServerTextEditTrustworthy(inconsistent), false);
});

/** A mutation whose size and colour still match what the editor seeded them from. */
function untouchedMutation(
  overrides: Partial<PdfEditorTextMutation> = {},
): PdfEditorTextMutation {
  return {
    page: 3,
    x: 40,
    y: 50,
    width: 120,
    height: 18,
    sourceFontSize: 9,
    sourceColor: UNKNOWN_SOURCE_TEXT_COLOR,
    text: 'New body copy',
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: UNKNOWN_SOURCE_TEXT_COLOR,
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    lineHeight: 1.4,
    ...overrides,
  };
}

test('mutation mapping forwards a size the user actually changed', () => {
  const request = toServerTextEditRequest(
    untouchedMutation({ fontSize: 14, color: '#112233', bold: true, align: 'center' }),
    'Old body copy',
    'm-7',
  );
  assert.equal(request.fontSize, 14);
  assert.equal(request.color, '#112233');
  assert.equal(request.originalText, 'Old body copy');
  assert.equal(request.newText, 'New body copy');
  assert.equal(request.id, 'm-7');
  assert.equal(request.page, 3);
  assert.equal(request.align, 'center');
  assert.equal(request.bold, true);
});

test('an unchanged size and colour are omitted so the engine inherits them', () => {
  // D3/D4. The client's numbers are guesses: the size is derived from PDF.js
  // text metrics and the colour is a placeholder, because `getTextContent()`
  // reports no fill colour at all. Sending them anyway is how 14pt blue text
  // silently became 12pt black text while the report still said "verified".
  const request = toServerTextEditRequest(untouchedMutation(), 'Old body copy', 'm-1');

  assert.equal('fontSize' in request, false, 'an unchanged size must not be sent');
  assert.equal('color' in request, false, 'a placeholder colour must not be sent');
  // Everything else the engine cannot infer is still sent.
  assert.equal(request.lineHeight, 1.4);
  assert.equal(request.newText, 'New body copy');
});

test('a colour differing only in case or hash is still treated as unchanged', () => {
  // Round-tripping through a colour input can restyle the same value. Treating
  // `#111111` and `111111` as different would defeat the inheritance rule for
  // no reason the user could ever observe.
  const request = toServerTextEditRequest(
    untouchedMutation({ sourceColor: '#AABBCC', color: 'aabbcc' }),
    'Old',
    'm-2',
  );
  assert.equal('color' in request, false);
});

test('a mutation with no recorded source colour falls back to the placeholder', () => {
  // `sourceColor` is optional, so older drafts and other call sites omit it.
  // The fallback must be the same sentinel the editor seeds with, or every such
  // mutation would look like a deliberate colour choice.
  const withoutSource = { ...untouchedMutation() };
  delete withoutSource.sourceColor;
  const request = toServerTextEditRequest(withoutSource, 'Old', 'm-3');
  assert.equal('color' in request, false);
});

test('an unknown source size is treated as a change rather than trusted', () => {
  // If we cannot tell what the source size was, we cannot claim the user left
  // it alone. Sending the explicit value is the honest, non-silent choice.
  const request = toServerTextEditRequest(
    untouchedMutation({ sourceFontSize: Number.NaN, fontSize: 11 }),
    'Old',
    'm-4',
  );
  assert.equal(request.fontSize, 11);
});

test('acknowledgement flags are only sent when actually granted', () => {
  const plain = toServerTextEditRequest(untouchedMutation(), 'Old', 'm-5');
  assert.equal('acknowledgeFidelityLoss' in plain, false);
  assert.equal('allowNeighbourLoss' in plain, false);

  const granted = toServerTextEditRequest(untouchedMutation(), 'Old', 'm-6', {
    acknowledgeFidelityLoss: true,
    allowNeighbourLoss: true,
  });
  assert.equal(granted.acknowledgeFidelityLoss, true);
  assert.equal(granted.allowNeighbourLoss, true);
});

test('a destructive redaction mode is never trustworthy', () => {
  // D2. Text-level verification cannot see that the image under the box was
  // blanked, so the mode itself has to gate the download.
  for (const mode of ['graphics', 'images', '', 'none']) {
    const escalated = report({
      outcomes: [{
        id: 'edit-1',
        page: 1,
        status: 'applied',
        originalRemoved: true,
        replacementPresent: true,
        redactionMode: mode,
      }],
    });
    assert.equal(
      isServerTextEditTrustworthy(escalated),
      false,
      `mode "${mode}" must not be accepted`,
    );
  }
});

test('an engine too old to report a redaction mode is not trusted', () => {
  const silent = report({
    outcomes: [{
      id: 'edit-1',
      page: 1,
      status: 'applied',
      originalRemoved: true,
      replacementPresent: true,
    }],
  });
  assert.equal(isServerTextEditTrustworthy(silent), false);
});

test('disclosures name every downgrade the engine performed', () => {
  const downgraded = report({
    outcomes: [{
      id: 'edit-1',
      page: 4,
      status: 'applied',
      originalRemoved: true,
      replacementPresent: true,
      redactionMode: 'graphics',
      // The engine's real shape for a shrunk edit: `sizeUsed` is the size it
      // actually wrote, which equals `shrunkFontSize`. The size it *wanted*
      // lives in `sizeIntended`. This fixture used to carry `sizeUsed: 14`
      // with `shrunkFontSize: 6.5`, a combination the server cannot produce,
      // and that invention is what hid a shrink disclosure that could never fire.
      sizeIntended: 14,
      sizeUsed: 6.5,
      shrunkFontSize: 6.5,
      fontRequested: 'Times-Bold',
      fontUsed: 'NotoSansBengali-Regular',
      typefacePreserved: false,
    }],
  });
  const disclosures = describeServerTextEditDisclosures(downgraded);
  assert.equal(disclosures.length, 3);
  assert.ok(disclosures.some((line) => /graphics/.test(line) && /Page 4/.test(line)));
  assert.ok(disclosures.some((line) => /14pt to 6\.5pt/.test(line)));
  assert.ok(disclosures.some((line) => /Times-Bold/.test(line) && /NotoSansBengali/.test(line)));
});

test('a clean export discloses nothing', () => {
  // The disclosure list is the UI's warning channel. If it cried wolf on a
  // faithful export, users would learn to ignore it.
  assert.deepEqual(describeServerTextEditDisclosures(report()), []);
});

test('a shrink is not reported when the engine used the size it intended', () => {
  const same = report({
    outcomes: [{
      id: 'edit-1',
      page: 1,
      status: 'applied',
      originalRemoved: true,
      replacementPresent: true,
      redactionMode: NON_DESTRUCTIVE_REDACTION_MODE,
      sizeIntended: 12,
      sizeUsed: 12,
      shrunkFontSize: 12,
    }],
  });
  assert.deepEqual(describeServerTextEditDisclosures(same), []);
});

test('reflowing a long replacement into blank space is disclosed', () => {
  // The engine's preferred concession: keep the document's type size and use
  // the empty margin instead. Nothing is lost, but the replacement covers more
  // of the page than the text it replaced, so the user is told.
  const grown = report({
    outcomes: [{
      id: 'edit-1',
      page: 2,
      status: 'applied',
      originalRemoved: true,
      replacementPresent: true,
      redactionMode: NON_DESTRUCTIVE_REDACTION_MODE,
      sizeIntended: 11,
      sizeUsed: 11,
      layoutExpanded: true,
    }],
  });
  const disclosures = describeServerTextEditDisclosures(grown);
  assert.equal(disclosures.length, 1);
  assert.match(disclosures[0], /Page 2/);
  assert.match(disclosures[0], /blank space/);
  // It must not read as a downgrade of the text itself.
  assert.match(disclosures[0], /Nothing was deleted or shrunk/);
});

test('an edit that fits its own box reports neither shrink nor reflow', () => {
  // The ordinary case, and the one that regressed: every text edit used to come
  // back shrunk because a one-line box cannot hold a line set at 1.3 leading.
  const untouched = report({
    outcomes: [{
      id: 'edit-1',
      page: 1,
      status: 'applied',
      originalRemoved: true,
      replacementPresent: true,
      redactionMode: NON_DESTRUCTIVE_REDACTION_MODE,
      sizeIntended: 10,
      sizeUsed: 10,
      shrunkFontSize: null,
      layoutExpanded: false,
    }],
  });
  assert.deepEqual(describeServerTextEditDisclosures(untouched), []);
});

// ---------------------------------------------------------------------------
// Failure attribution. The refusal message is the only thing a developer gets
// when an export will not download, so it is held to the same standard as the
// trust contract itself.
// ---------------------------------------------------------------------------

const ROLLBACK_REASON =
  'Rolled back because another edit in this atomic request failed verification. '
  + 'No changes were committed.';

/** A refusal shaped like the real one: one cause, many collateral rollbacks. */
function atomicRollbackReport(collateralCount: number, cause: string): ServerTextEditReport {
  const outcomes: ServerTextEditReport['outcomes'] = [{
    id: 'text-7',
    page: 2,
    status: 'unverified',
    reason: cause,
  }];
  for (let index = 0; index < collateralCount; index += 1) {
    outcomes.push({
      id: `text-${index + 20}`,
      page: 1,
      status: 'unverified',
      reason: ROLLBACK_REASON,
    });
  }
  return report({
    status: 'refused',
    summary: 'Atomic text-edit transaction refused: 1 edit(s) failed or could not be verified. '
      + 'No changes were committed.',
    outcomes,
    pdf: null,
    pdfSize: null,
    pdfSha256: null,
    engine: { committed: false, editsRequested: outcomes.length, transactionMode: 'atomic' },
  });
}

test('the real cause is named first, not buried under repeated rollback lines', () => {
  // The defect this replaced: 21 identical rollback sentences concatenated
  // ahead of, or around, the one line that says what actually went wrong.
  const cause = 'Neighbour-preservation guard: edit \'text-7\' on page 2 lost "ahmed@gmail.com".';
  const described = describeServerTextEditFailure(atomicRollbackReport(21, cause));

  assert.equal(described.groups.length, 2, 'two distinct reasons, not 22 lines');
  assert.equal(described.groups[0].reason, cause, 'the rarest reason sorts first');
  assert.deepEqual(described.groups[0].outcomes.map((item) => item.id), ['text-7']);
  assert.equal(described.groups[1].outcomes.length, 21);

  const lines = described.message.split('\n');
  assert.equal(lines.length, 3, 'headline + one line per distinct reason');
  assert.ok(lines[1].includes(cause));
  assert.ok(lines[1].includes('text-7'), 'the causing edit is identified');
  assert.ok(lines[1].includes('page 2'), 'and so is its page');
  assert.ok(lines[1].includes('unverified'), 'and the stage it failed at');
});

test('a long collateral group collapses to a count instead of listing every id', () => {
  const described = describeServerTextEditFailure(atomicRollbackReport(21, 'Primary cause.'));
  const collateral = described.message.split('\n')[2];

  assert.ok(collateral.includes('text-20'), 'the first few ids stay visible');
  assert.ok(collateral.includes('+ 15 more'), 'the rest are counted, not listed');
  assert.equal(collateral.includes('text-39'), false, 'the tail is not dumped');
  assert.ok(collateral.includes(ROLLBACK_REASON), 'the shared reason is stated once');
});

test('two distinct causes are both reported, each with its own edits', () => {
  const described = describeServerTextEditFailure(report({
    status: 'refused',
    summary: 'Atomic text-edit transaction refused.',
    outcomes: [
      { id: 'text-1', page: 1, status: 'refused', reason: 'Unnamed-text guard: box too wide.' },
      { id: 'text-4', page: 3, status: 'unverified', reason: 'Neighbour-preservation guard: lost "Acme".' },
      { id: 'text-5', page: 3, status: 'unverified', reason: 'Neighbour-preservation guard: lost "Acme".' },
    ],
    pdf: null,
    pdfSize: null,
    pdfSha256: null,
    engine: { committed: false, editsRequested: 3, transactionMode: 'atomic' },
  }));

  assert.equal(described.groups.length, 2);
  assert.deepEqual(described.groups[0].outcomes.map((item) => item.id), ['text-1']);
  assert.deepEqual(described.groups[1].outcomes.map((item) => item.id), ['text-4', 'text-5']);
  assert.ok(described.message.includes('text-4, text-5 (page 3)'));
  assert.equal(described.defects.length, 0, 'an honest refusal has no contract defect');
});

test('a refusal is not reported as a contract defect for withholding bytes', () => {
  // Fail-closed is the documented shape: refused arrives with pdf: null and
  // committed: false. Flagging that would make every real refusal noisy.
  const described = describeServerTextEditFailure(atomicRollbackReport(1, 'Primary cause.'));
  assert.deepEqual(described.defects, []);
  assert.equal(described.message.includes('[contract]'), false);
});

test('an "applied" edit with no proof behind it is named as a contract defect', () => {
  // The silent case: nothing is in the failure list because the engine claims
  // success, yet the trust check refuses the download. Without this the UI
  // could only say "export failed" with no cause at all.
  const silent = report({
    outcomes: [{
      id: 'edit-1',
      page: 1,
      status: 'applied',
      originalRemoved: false,
      replacementPresent: true,
      redactionMode: NON_DESTRUCTIVE_REDACTION_MODE,
    }],
  });
  assert.equal(isServerTextEditTrustworthy(silent), false);

  const described = describeServerTextEditFailure(silent);
  assert.equal(described.groups.length, 0, 'nothing reported itself as failed');
  assert.equal(described.defects.length, 1);
  assert.match(described.defects[0], /edit-1 \(page 1\) reported "applied"/);
  assert.match(described.defects[0], /originalRemoved is not true/);
  assert.ok(described.message.includes('[contract]'));
});

test('a destructive redaction mode is named even when the edit says applied', () => {
  const described = describeServerTextEditFailure(report({
    outcomes: [{
      id: 'edit-1',
      page: 1,
      status: 'applied',
      originalRemoved: true,
      replacementPresent: true,
      redactionMode: 'none',
    }],
  }));
  assert.equal(described.defects.length, 1);
  assert.match(described.defects[0], /redactionMode is "none"/);
  assert.ok(described.defects[0].includes(NON_DESTRUCTIVE_REDACTION_MODE));
});

test('missing integrity evidence on a verified report is named precisely', () => {
  const described = describeServerTextEditFailure(report({
    status: 'verified',
    pdfSha256: 'not-a-digest',
    pdfSize: 0,
  }));
  assert.equal(described.groups.length, 0);
  assert.ok(described.defects.some((line) => /pdfSize is 0/.test(line)));
  assert.ok(described.defects.some((line) => /pdfSha256 is "not-a-digest"/.test(line)));
});

test('a non-atomic report is called out, since the rollback guarantee is void', () => {
  const described = describeServerTextEditFailure(report({
    engine: { committed: true, editsRequested: 1, transactionMode: 'best-effort' as 'atomic' },
  }));
  assert.ok(described.defects.some((line) => /transactionMode/.test(line) && /atomic/.test(line)));
});

test('an outcome count that does not match the request is called out', () => {
  const described = describeServerTextEditFailure(report({
    engine: { committed: true, editsRequested: 4, transactionMode: 'atomic' },
  }));
  assert.ok(described.defects.some((line) => /1 outcome\(s\) for 4 requested/.test(line)));
});

test('an edit with no reason still gets a line rather than vanishing', () => {
  const described = describeServerTextEditFailure(report({
    status: 'refused',
    summary: 'Atomic text-edit transaction refused.',
    outcomes: [{ id: 'text-1', page: 1, status: 'unverified' }],
    pdf: null,
    pdfSize: null,
    pdfSha256: null,
    engine: { committed: false, editsRequested: 1, transactionMode: 'atomic' },
  }));
  assert.equal(described.groups.length, 1);
  assert.match(described.groups[0].reason, /no reason/i);
  assert.ok(described.message.includes('text-1 (page 1)'));
});

test('an empty summary falls back to a headline that still states the verdict', () => {
  const described = describeServerTextEditFailure(report({
    status: 'refused',
    summary: '   ',
    outcomes: [{ id: 'text-1', page: 1, status: 'refused', reason: 'Box covers unnamed text.' }],
    pdf: null,
    pdfSize: null,
    pdfSha256: null,
    engine: { committed: false, editsRequested: 1, transactionMode: 'atomic' },
  }));
  assert.match(described.headline, /refused/);
  assert.equal(described.message.split('\n')[0], described.headline);
});

test('the same report always renders the same message', () => {
  // The message reaches bug reports and screenshots; two runs must not order
  // equal-sized groups differently.
  const build = () => describeServerTextEditFailure(report({
    status: 'refused',
    summary: 'Atomic text-edit transaction refused.',
    outcomes: [
      { id: 'text-1', page: 1, status: 'refused', reason: 'Cause A.' },
      { id: 'text-2', page: 2, status: 'refused', reason: 'Cause B.' },
    ],
    pdf: null,
    pdfSize: null,
    pdfSha256: null,
    engine: { committed: false, editsRequested: 2, transactionMode: 'atomic' },
  })).message;
  assert.equal(build(), build());
  assert.ok(build().indexOf('Cause A.') < build().indexOf('Cause B.'));
});

test('empty edit list is refused before any network call', async () => {
  let called = false;
  const result = await applyServerTextEdits({
    source: new Uint8Array([1, 2, 3]),
    edits: [],
    transport: async () => {
      called = true;
      return { status: 200, json: async () => report() };
    },
  });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : '', /No text edits/i);
});

test('a verified answer decodes the returned document', async () => {
  const calls: { endpoint?: string; form?: FormData } = {};
  const result = await applyServerTextEdits({
    source: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    edits: [edit()],
    transport: stubTransport(report(), calls),
  });

  assert.equal(calls.endpoint, SERVER_TEXT_EDIT_ENDPOINT);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(isServerTextEditTrustworthy(result.report), true);
    assert.ok(result.pdfBytes && result.pdfBytes.byteLength > 0);
    assert.equal(
      Buffer.from(result.pdfBytes as Uint8Array).toString('utf8').startsWith('%PDF'),
      true,
    );
  }
});

test('the request carries the file and the serialised edits', async () => {
  const calls: { endpoint?: string; form?: FormData } = {};
  await applyServerTextEdits({
    source: new Uint8Array([1, 2, 3, 4]),
    edits: [edit({ id: 'payload-check' })],
    filename: 'contract.pdf',
    transport: stubTransport(report(), calls),
  });

  const form = calls.form;
  assert.ok(form);
  const file = form.get('file');
  assert.ok(file instanceof Blob);
  assert.equal((file as File).name, 'contract.pdf');
  const parsed = JSON.parse(String(form.get('edits'))) as ServerTextEditRequest[];
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'payload-check');
});

test('a refusal is an answer, not an error, and yields no bytes', async () => {
  const result = await applyServerTextEdits({
    source: new Uint8Array([1]),
    edits: [edit()],
    transport: stubTransport(
      report({
        status: 'refused',
        summary: 'No text edit could be applied.',
        outcomes: [{ id: 'edit-1', page: 1, status: 'refused', reason: 'Region has no text.' }],
        pdf: null,
        pdfSize: null,
        pdfSha256: null,
        engine: { committed: false, editsRequested: 1, transactionMode: 'atomic' },
      }),
    ),
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.pdfBytes, null);
    assert.equal(isServerTextEditTrustworthy(result.report), false);
    assert.equal(result.report.outcomes[0]?.reason, 'Region has no text.');
  }
});

test('a transport failure never falls back to the overlay path', async () => {
  const result = await applyServerTextEdits({
    source: new Uint8Array([1]),
    edits: [edit()],
    transport: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Could not reach the text-edit service/i);
    // The message must state that nothing changed, so the UI cannot imply a
    // successful edit happened locally.
    assert.match(result.error, /No changes were applied/i);
  }
});

test('success without a document is treated as failure', async () => {
  const result = await applyServerTextEdits({
    source: new Uint8Array([1]),
    edits: [edit()],
    transport: stubTransport(report({ status: 'verified', pdf: null })),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /returned no document/i);
});

test('route-level validation errors surface verbatim', () => {
  const parsed = parseServerTextEditReport({ error: 'No file uploaded.' });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.error, 'No file uploaded.');
});

test('an unrecognised status is rejected rather than guessed', () => {
  assert.equal(parseServerTextEditReport({ status: 'probably-fine' }).ok, false);
  assert.equal(parseServerTextEditReport(null).ok, false);
  assert.equal(parseServerTextEditReport('ok').ok, false);
});

test('missing transaction evidence is rejected rather than defaulted', () => {
  const parsed = parseServerTextEditReport({ status: 'refused' });
  assert.equal(parsed.ok, false);
});

test('partial responses are rejected by the atomic client contract', () => {
  const parsed = parseServerTextEditReport(report({
    status: 'partial',
    engine: { committed: false, editsRequested: 1, transactionMode: 'atomic' },
  }));
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.error, /Partial.*not supported/i);
});

test('verified status without removal proof is rejected', () => {
  const parsed = parseServerTextEditReport(report({
    outcomes: [{ id: 'edit-1', page: 1, status: 'applied', replacementPresent: true }],
  }));
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.error, /inconsistent verification evidence/i);
});

test('response edit ids must exactly match the atomic request', async () => {
  const result = await applyServerTextEdits({
    source: new Uint8Array([1]),
    edits: [edit({ id: 'expected-id' })],
    transport: stubTransport(report()),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /did not match the requested edit set/i);
});

test('duplicate request ids are refused before transport', async () => {
  let called = false;
  const result = await applyServerTextEdits({
    source: new Uint8Array([1]),
    edits: [edit(), edit()],
    transport: async () => {
      called = true;
      return { status: 200, json: async () => report() };
    },
  });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /unique non-empty id/i);
});

test('a PDF whose hash differs from the report is refused', async () => {
  const result = await applyServerTextEdits({
    source: new Uint8Array([1]),
    edits: [edit()],
    transport: stubTransport(report({ pdfSha256: '0'.repeat(64) })),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /integrity check/i);
});

test('truncated non-PDF bytes are refused before download', async () => {
  const badBytes = Buffer.from('not-a-complete-pdf');
  const result = await applyServerTextEdits({
    source: new Uint8Array([1]),
    edits: [edit()],
    transport: stubTransport(report({
      pdf: badBytes.toString('base64'),
      pdfSize: badBytes.length,
      pdfSha256: '0'.repeat(64),
    })),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /not a complete PDF/i);
});

test('a non-2xx response cannot be treated as a committed export', async () => {
  const transport: ServerTextEditTransport = async () => ({
    status: 503,
    json: async () => report(),
  });
  const result = await applyServerTextEdits({
    source: new Uint8Array([1]),
    edits: [edit()],
    transport,
  });
  assert.equal(result.ok, false);
});

test('an unreadable body is reported instead of crashing the export', async () => {
  const result = await applyServerTextEdits({
    source: new Uint8Array([1]),
    edits: [edit()],
    transport: async () => ({
      status: 502,
      json: async () => {
        throw new Error('invalid json');
      },
    }),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /unreadable response/i);
});

/* ── Consent ──────────────────────────────────────────────────────────────── */

/** Verbatim from `pdf_editor_text.py::_document_fidelity_risks`. */
const FIDELITY_REFUSAL_400 =
  'Refusing to edit this document because it is encrypted, so editing it writes '
  + 'back a decrypted copy. Re-send with acknowledgeFidelityLoss to accept that '
  + 'loss explicitly.';

/** Verbatim shape from `pdf_editor_text.py`'s unnamed-text guard. */
const NEIGHBOUR_REFUSAL_REASON =
  "Unnamed-text guard: the box for edit 'text-2' on page 3 also covers text that "
  + 'originalText does not name, which redaction would delete with nothing put '
  + 'back: "Confidential". Resize the box to cover only the text being replaced, '
  + 'or send allowNeighbourLoss to accept the deletion.';

const EXPORT_DECISION = {
  mode: 'structure-preserving',
  preservation: 'source-structure',
  reason: 'Original-size edits can be appended to the source PDF.',
} as const;

function refusedReport(reason: string, id = 'text-2'): ServerTextEditReport {
  return report({
    status: 'refused',
    summary: 'No edits were applied; the transaction was rolled back.',
    outcomes: [{ id, page: 3, status: 'refused', reason }],
    pdf: null,
    pdfSize: null,
    pdfSha256: null,
    engine: { committed: false, editsRequested: 1, transactionMode: 'atomic' },
  });
}

test('the HTTP 400 fidelity refusal is recognised as a consent request', () => {
  // This shape carries no report at all: the route answers `{ error }`, so the
  // classifier has to read the bare error string.
  const consent = classifyServerTextEditConsent({ error: FIDELITY_REFUSAL_400 });

  assert.ok(consent);
  assert.equal(consent.acknowledgeFidelityLoss, true);
  assert.deepEqual(consent.allowNeighbourLossEditIds, []);
  assert.deepEqual(consent.reasons, [FIDELITY_REFUSAL_400]);
});

test('the unnamed-text guard inside a 200 refused report is recognised', () => {
  const consent = classifyServerTextEditConsent({
    report: refusedReport(NEIGHBOUR_REFUSAL_REASON),
  });

  assert.ok(consent);
  assert.equal(consent.acknowledgeFidelityLoss, false);
  // Attributed to the refused edit, not granted document-wide.
  assert.deepEqual(consent.allowNeighbourLossEditIds, ['text-2']);
});

test('snake_case flag names in a reason are recognised too', () => {
  const consent = classifyServerTextEditConsent({
    error: 'Refusing to edit. Re-send with acknowledge_fidelity_loss to accept.',
  });
  assert.equal(consent?.acknowledgeFidelityLoss, true);
});

test('a refusal that names no flag is not consent-recoverable', () => {
  assert.equal(
    classifyServerTextEditConsent({
      error: 'Could not reach the text-edit service. No changes were applied.',
    }),
    null,
  );
  assert.equal(
    classifyServerTextEditConsent({
      report: refusedReport('The page could not be parsed.'),
    }),
    null,
  );
  assert.equal(classifyServerTextEditConsent({}), null);
});

test('an applied outcome is never mined for consent', () => {
  // Defensive: a disclosure that happens to mention the flag must not turn a
  // successful edit into a consent prompt.
  const consent = classifyServerTextEditConsent({
    report: report({
      outcomes: [{
        id: 'text-1',
        page: 1,
        status: 'applied',
        originalRemoved: true,
        replacementPresent: true,
        redactionMode: NON_DESTRUCTIVE_REDACTION_MODE,
        reason: 'mentions allowNeighbourLoss in passing',
      }],
    }),
  });
  assert.equal(consent, null);
});

test('a neighbour guard with no edit id is not granted', () => {
  // No id means no edit to attach the grant to, so the export must stay refused
  // rather than silently authorise deletion somewhere unnamed.
  const consent = classifyServerTextEditConsent({
    error: 'send allowNeighbourLoss to accept the deletion.',
  });
  assert.equal(consent, null);
});

test('both gates are collected when they arrive together', () => {
  const consent = classifyServerTextEditConsent({
    error: FIDELITY_REFUSAL_400,
    report: refusedReport(NEIGHBOUR_REFUSAL_REASON),
  });

  assert.ok(consent);
  assert.equal(consent.acknowledgeFidelityLoss, true);
  assert.deepEqual(consent.allowNeighbourLossEditIds, ['text-2']);
  assert.equal(consent.reasons.length, 2);
});

test('a grant applies only to the edit the engine refused', () => {
  const consent = classifyServerTextEditConsent({
    report: refusedReport(NEIGHBOUR_REFUSAL_REASON, 'text-2'),
  });
  assert.ok(consent);

  assert.deepEqual(serverTextEditConsentFor(consent, 'text-2'), { allowNeighbourLoss: true });
  // The untouched edit gets nothing — this is the difference between accepting
  // one box's loss and authorising deletion inside every box.
  assert.deepEqual(serverTextEditConsentFor(consent, 'text-1'), {});
  assert.deepEqual(serverTextEditConsentFor(null, 'text-2'), {});
});

test('the request carries only the flag that was actually granted', () => {
  const mutation: PdfEditorTextMutation = {
    page: 1,
    x: 1,
    y: 2,
    width: 3,
    height: 4,
    sourceFontSize: 12,
    sourceColor: UNKNOWN_SOURCE_TEXT_COLOR,
    text: 'New',
    fontSize: 12,
    fontFamily: 'Helvetica',
    color: UNKNOWN_SOURCE_TEXT_COLOR,
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    lineHeight: 1.15,
  };
  const consent = classifyServerTextEditConsent({ error: FIDELITY_REFUSAL_400 });
  assert.ok(consent);

  const request = toServerTextEditRequest(
    mutation,
    'Old',
    'text-1',
    serverTextEditConsentFor(consent, 'text-1'),
  );

  assert.equal(request.acknowledgeFidelityLoss, true);
  // Never defaulted on: the engine did not ask for it, so it is absent.
  assert.equal('allowNeighbourLoss' in request, false);
});

test('grants accumulate across the two sequential gates', () => {
  // An encrypted document is refused for fidelity before any edit is inspected,
  // so the neighbour guard can only appear on the retry. Losing the first grant
  // there would loop the user between two dialogs.
  const first = classifyServerTextEditConsent({ error: FIDELITY_REFUSAL_400 });
  const second = classifyServerTextEditConsent({
    report: refusedReport(NEIGHBOUR_REFUSAL_REASON),
  });
  assert.ok(first);
  assert.ok(second);

  const merged = mergeServerTextEditConsent(first, second);
  assert.equal(merged.acknowledgeFidelityLoss, true);
  assert.deepEqual(merged.allowNeighbourLossEditIds, ['text-2']);
  assert.equal(merged.reasons.length, 2);

  assert.deepEqual(mergeServerTextEditConsent(null, second), second);
  // Merging is idempotent, so a repeated dialog cannot duplicate a grant.
  assert.deepEqual(mergeServerTextEditConsent(merged, merged), merged);
});

test('the consent impact quotes the endangered text verbatim', () => {
  const consent = classifyServerTextEditConsent({
    report: refusedReport(NEIGHBOUR_REFUSAL_REASON),
  });
  assert.ok(consent);

  const impact = buildServerTextEditConsentImpact(consent, EXPORT_DECISION);

  assert.equal(impact.requiresConfirmation, true);
  assert.equal(impact.severity, 'critical');
  // The exact characters that would be deleted must reach the user; a
  // paraphrase makes this an uninformed click.
  assert.ok(impact.consequences.some((item) => item.detail.includes('"Confidential"')));
  assert.ok(impact.consequences.some((item) => item.id === 'server-text-edit-neighbour-loss'));
  assert.equal(
    impact.consequences.some((item) => item.id === 'server-text-edit-fidelity-loss'),
    false,
  );
});

test('the consent impact keeps the real export decision so approval cannot be replayed', () => {
  const consent = classifyServerTextEditConsent({ error: FIDELITY_REFUSAL_400 });
  assert.ok(consent);

  const impact = buildServerTextEditConsentImpact(consent, EXPORT_DECISION);

  // `isConfirmedExportMode` compares the confirmed mode against this, so it has
  // to be the mode the user was actually shown.
  assert.deepEqual(impact.decision, EXPORT_DECISION);
  assert.ok(impact.consequences.some((item) => item.id === 'server-text-edit-fidelity-loss'));
  assert.ok(impact.preservationNotes.length > 0);
  assert.match(impact.confirmLabel, /accept/i);
});

test('the consent impact names both losses when both were requested', () => {
  const impact = buildServerTextEditConsentImpact(
    {
      acknowledgeFidelityLoss: true,
      allowNeighbourLossEditIds: ['text-2', 'text-5'],
      reasons: [FIDELITY_REFUSAL_400, NEIGHBOUR_REFUSAL_REASON],
    },
    EXPORT_DECISION,
  );

  assert.match(impact.title, /protection/i);
  assert.match(impact.title, /unnamed text/i);
  assert.ok(impact.consequences.some((item) => item.title.includes('2 edit boxes')));
  // Both engine sentences are carried through for the dialog to show.
  assert.equal(
    impact.consequences.filter(
      (item) => item.id.startsWith('server-text-edit-consent-reason-'),
    ).length,
    2,
  );
});

test('a redaction mutation is marked as redaction for metadata sanitization', () => {
  // The engine must be able to tell "delete this line" apart from "this is a
  // redaction": only the latter erases author, title and XMP metadata.
  const request = toServerTextEditRequest(
    untouchedMutation({ text: '', redact: true }),
    'Salary 120000 USD',
    'redact:1:2',
  );

  assert.equal(request.newText, '');
  assert.equal(request.redact, true);
  assert.equal(request.originalText, 'Salary 120000 USD');
});

test('an ordinary text mutation does not request metadata erasure', () => {
  const request = toServerTextEditRequest(untouchedMutation(), 'Old body copy', 'm-1');
  assert.equal('redact' in request, false);
});
