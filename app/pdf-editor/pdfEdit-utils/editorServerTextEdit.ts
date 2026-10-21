/**
 * Client for the structural text-edit engine.
 *
 * Why this exists
 * ---------------
 * `editorExport.ts` cannot edit text. It paints an opaque rectangle over the old
 * glyphs and draws the replacement on top, so the original characters remain in
 * the content stream and stay selectable, copyable and searchable.
 * `editorContentRemoval.ts` proves that leak and a test asserts it. This module
 * routes the same edits to the server engine, which deletes the original glyphs
 * from the content stream and re-inserts real PDF text.
 *
 * Contract rules, all of which exist so we never hand back a document that looks
 * edited but is not:
 *
 * 1. **The report decides, not the HTTP status.** A 200 can carry
 *    `status: "refused"`. Callers must use {@link isServerTextEditTrustworthy}
 *    rather than "the request succeeded".
 * 2. **`partial` is invalid.** Atomic transactions never return mixed bytes. If
 *    any edit is refused or unverified, no edited document is downloadable.
 * 3. **No silent fallback to the overlay path.** A transport failure returns a
 *    refusal the UI must surface. Quietly reverting to cover-and-retype would
 *    reintroduce the exact bug this path removes.
 *
 * Transport is injected so the whole contract is unit-testable without a server
 * and without a browser.
 */

import type { PdfEditorTextMutation, PdfEditorExportDecision } from './editorExport';
import type { PdfExportConsequence, PdfExportImpact } from './editorPreflight';

/** Endpoint kept here so tests and callers cannot drift on the path. */
export const SERVER_TEXT_EDIT_ENDPOINT = '/api/pdf-editor/apply-text-edits';

/**
 * One edit as the Python engine expects it. Rectangles are in PDF points with a
 * **top-left origin**, in the page's **visual** (rotated) space — what the user
 * actually sees and clicked on. The engine maps them into unrotated page space
 * itself via `page.derotation_matrix`; sending pre-derotated coordinates would
 * double-apply the rotation. Snake_case aliases are accepted by the server, but
 * we send camelCase consistently so a payload diff is readable.
 *
 * `fontSize` and `color` are **optional on purpose**. Omitting them tells the
 * engine to inherit the replaced span's real size and fill colour, which is the
 * only way to avoid silently turning 14pt blue text into 12pt black text.
 * Send them only when the user explicitly chose a different value.
 */
export type ServerTextEditRequest = {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  originalText: string;
  newText: string;
  fontSize?: number | null;
  lineHeight: number;
  color?: string | null;
  align: string;
  bold: boolean;
  italic: boolean;
  /**
   * Accept that editing rewrites the whole file, decrypting an encrypted
   * document and invalidating any digital signature. The engine refuses such
   * documents without this, so the UI must collect a real acknowledgement
   * rather than defaulting it on.
   */
  acknowledgeFidelityLoss?: boolean;
  /**
   * Accept that text inside the edit box which `originalText` does not name
   * will be deleted with nothing put back. Also refused by default: it is
   * unrecoverable loss that no later verification step can detect.
   */
  allowNeighbourLoss?: boolean;
  /**
   * This edit is a redaction, not a rewrite: the source run must disappear with
   * nothing put back, and the document's identifying metadata must be erased.
   *
   * Explicit rather than inferred from `newText === ''`. Deleting a line is an
   * ordinary edit; erasing the author, title, creation dates and XMP record is
   * a stronger promise that must only run when the user asked for redaction.
   * Explicit rather than inferred from an empty `newText`, because deleting a
   * line is an ordinary edit while erasing author/title/dates is a stronger
   * promise only the redaction flow may make.
   */
  redact?: boolean;
};

/**
 * Per-edit result.
 *
 * - `applied`: old glyphs removed *and* replacement verified present.
 * - `refused`: page untouched; `reason` says why.
 * - `unverified`: something was written but the engine could not prove the
 *   original is gone. Treated as failure, never as success.
 */
export type ServerTextEditOutcomeStatus = 'applied' | 'refused' | 'unverified';

/** Where a rendered typography value came from. */
export type ServerTextEditValueSource = 'request' | 'source-span' | 'fallback';

export type ServerTextEditOutcome = {
  id: string;
  page: number;
  status: ServerTextEditOutcomeStatus;
  reason?: string | null;
  /** The face actually written, e.g. `Times-Bold` or `NotoSansBengali-Regular`. */
  fontUsed?: string | null;
  originalRemoved?: boolean;
  replacementPresent?: boolean;
  /**
   * Set when the replacement did not fit at its intended size and the engine
   * shrank it. A legitimate outcome, but a downgrade the user must see — this
   * is how a 14pt line quietly becomes 4pt.
   *
   * Compare against {@link sizeIntended}, never {@link sizeUsed}: on a shrunk
   * edit the engine sets both of the latter to the *same* shrunk value, so a
   * `shrunkFontSize < sizeUsed` test can never be true and the disclosure it
   * guards never appears.
   */
  shrunkFontSize?: number | null;
  /** How many source spans the edit box covered. */
  matchedSpans?: number;
  /** Typography actually written, and where each value came from (rule 5). */
  sizeUsed?: number | null;
  sizeSource?: ServerTextEditValueSource | null;
  /**
   * The size the edit asked for, before any shrinking. Null on a refused edit,
   * where nothing was written at all.
   */
  sizeIntended?: number | null;
  /**
   * True when the replacement was too long for its own box and the engine
   * flowed it into blank space beside or below it instead of shrinking. The
   * text keeps the document's size, but it occupies more of the page than the
   * text it replaced, so the reflow is disclosed.
   */
  layoutExpanded?: boolean | null;
  colourUsed?: string | null;
  colourSource?: ServerTextEditValueSource | null;
  /** The replaced span's own typeface, whether or not we could keep it. */
  fontRequested?: string | null;
  /** False means the reader will see a different face than before. */
  typefacePreserved?: boolean | null;
  /**
   * Which redaction mode removed the glyphs. `graphics,images` is the only
   * non-destructive one; anything less means images or vector art under the
   * box were erased along with the text.
   */
  redactionMode?: string | null;
};


export type ServerTextEditStatus = 'verified' | 'partial' | 'refused';

export type ServerTextEditReport = {
  contractVersion: 1;
  transactionMode: 'atomic';
  status: ServerTextEditStatus;
  summary: string;
  outcomes: ServerTextEditOutcome[];
  /** Base64 PDF, or `null` when the engine refused outright. */
  pdf: string | null;
  filename?: string;
  pdfSize: number | null;
  pdfSha256: string | null;
  engine: {
    committed: boolean;
    editsRequested: number;
    transactionMode: 'atomic';
  };
};

export type ServerTextEditResult =
  | {
      ok: true;
      report: ServerTextEditReport;
      /** Edited bytes for `verified`; always absent for `refused`. */
      pdfBytes: Uint8Array | null;
    }
  | {
      ok: false;
      /** Message safe to show a user. Never a stack trace. */
      error: string;
      /** Present when the server answered with a report before failing. */
      report?: ServerTextEditReport;
    };

/**
 * The colour the editor shows for source text whose real colour is unknown.
 *
 * PDF.js `getTextContent()` does not report fill colour at all, so every
 * original text block is seeded with this placeholder. It is a rendering
 * approximation, **not** a fact about the document — forwarding it as an
 * explicit `color` is what used to turn grey and blue text black on export.
 * Exported so the editor and this client cannot drift on the sentinel.
 */
export const UNKNOWN_SOURCE_TEXT_COLOR = '#111111';

/** Case/'#'-insensitive hex compare, so `#FFF000` and `fff000` match. */
function sameColour(a: string | null | undefined, b: string | null | undefined) {
  const clean = (value: string | null | undefined) =>
    (value ?? '').trim().replace(/^#/, '').toLowerCase();
  return clean(a) === clean(b);
}

export type ToServerTextEditOptions = {
  /** Forwarded when the document is encrypted or signed and the user accepted it. */
  acknowledgeFidelityLoss?: boolean;
  /** Forwarded when the user accepted losing unnamed text inside the box. */
  allowNeighbourLoss?: boolean;
};

/**
 * Map an export-layer mutation onto the engine payload.
 *
 * Size and colour are forwarded **only when the user actually changed them**.
 * Anything left at the value the editor seeded from the source block is omitted
 * so the engine inherits the span's real size and fill colour from the glyphs
 * it is replacing. This matters because the client's own idea of both is
 * unreliable: the size is rounded off PDF.js text metrics and the colour is a
 * hardcoded placeholder ({@link UNKNOWN_SOURCE_TEXT_COLOR}). Sending them
 * unconditionally is what silently turned 14pt blue text into 12pt black text
 * while still reporting `verified`.
 */
export function toServerTextEditRequest(
  mutation: PdfEditorTextMutation,
  originalText: string,
  id: string,
  options: ToServerTextEditOptions = {},
): ServerTextEditRequest {
  const sourceFontSize = mutation.sourceFontSize;
  const sizeChanged = !Number.isFinite(sourceFontSize)
    || Math.abs(mutation.fontSize - sourceFontSize) > 0.01;
  const colourChanged = !sameColour(
    mutation.color,
    mutation.sourceColor ?? UNKNOWN_SOURCE_TEXT_COLOR,
  );

  return {
    id,
    page: mutation.page,
    x: mutation.x,
    y: mutation.y,
    width: mutation.width,
    height: mutation.height,
    originalText,
    newText: mutation.text,
    ...(sizeChanged ? { fontSize: mutation.fontSize } : {}),
    lineHeight: mutation.lineHeight,
    ...(colourChanged ? { color: mutation.color } : {}),
    align: mutation.align,
    bold: mutation.bold,
    italic: mutation.italic,
    ...(options.acknowledgeFidelityLoss ? { acknowledgeFidelityLoss: true } : {}),
    ...(options.allowNeighbourLoss ? { allowNeighbourLoss: true } : {}),
    ...(mutation.redact ? { redact: true } : {}),
  };
}

/**
 * The only redaction mode that removes text without destroying anything else.
 *
 * Every other mode blanks image pixels (`PDF_REDACT_IMAGE_PIXELS`) or deletes
 * vector art the box touches (`PDF_REDACT_LINE_ART_*`). The engine reports
 * which one ran; treating that report as decoration is how a silent escalation
 * to a destructive mode would still read as `verified`.
 */
export const NON_DESTRUCTIVE_REDACTION_MODE = 'graphics,images';

/**
 * The mode a *true redaction* uses. It also clears the image pixels and vector
 * art the marked box touches, because a redaction of a scanned page must remove
 * the visible words, not only the invisible OCR text layer above them.
 *
 * Kept distinct from {@link NON_DESTRUCTIVE_REDACTION_MODE} on the wire so the
 * client can accept it for an edit the user explicitly marked as a redaction
 * while still refusing it for an ordinary text edit (where it would destroy
 * content nobody asked to lose).
 */
export const VISIBLE_REDACTION_MODE = 'graphics=2,images=2';

/**
 * Which edits in a request were redactions.
 *
 * The report only says what the engine did; the request knows what the user
 * asked for. Passing this set is how "you asked to erase everything under this
 * box" is distinguished from "a text edit silently erased the artwork".
 */
export type ServerTextEditIdentityOptions = {
  redactionEditIds?: ReadonlySet<string>;
};

function isRedactionOutcome(
  outcome: ServerTextEditOutcome,
  options: ServerTextEditIdentityOptions,
): boolean {
  return options.redactionEditIds?.has(outcome.id) ?? false;
}

/** Fidelity downgrades the engine performed, in words the UI can show. */
export function describeServerTextEditDisclosures(
  report: ServerTextEditReport,
  options: ServerTextEditIdentityOptions = {},
): string[] {
  const disclosures: string[] = [];
  for (const outcome of report.outcomes) {
    if (outcome.status !== 'applied') continue;
    const where = `Page ${outcome.page}`;
    const redaction = isRedactionOutcome(outcome, options);
    if (outcome.redactionMode && outcome.redactionMode !== NON_DESTRUCTIVE_REDACTION_MODE) {
      if (redaction && outcome.redactionMode === VISIBLE_REDACTION_MODE) {
        // This is the requested outcome, not a downgrade: say what it did so
        // the user knows a scan's pixels were erased as well as its text.
        disclosures.push(
          `${where}: the redacted area was cleared through its images and vector art, not only its text layer.`,
        );
      } else {
        disclosures.push(
          `${where}: glyphs were removed in "${outcome.redactionMode}" mode, which can also erase images or vector art beneath the edit.`,
        );
      }
    }
    // Against `sizeIntended`, not `sizeUsed`. The engine sets `sizeUsed` to the
    // size it actually wrote, which on a shrunk edit *is* `shrunkFontSize` —
    // so the old `shrunkFontSize < sizeUsed` comparison was never true and this
    // disclosure never reached the user, however far the text had been shrunk.
    if (typeof outcome.shrunkFontSize === 'number'
      && typeof outcome.sizeIntended === 'number'
      && outcome.shrunkFontSize < outcome.sizeIntended) {
      disclosures.push(
        `${where}: the replacement did not fit and was shrunk from ${outcome.sizeIntended}pt to ${outcome.shrunkFontSize}pt.`,
      );
    }
    if (outcome.layoutExpanded === true) {
      disclosures.push(
        `${where}: the replacement was longer than the text it replaced, so it was flowed into the blank space beside or below it. Nothing was deleted or shrunk, but it now covers more of the page.`,
      );
    }
    if (outcome.typefacePreserved === false && outcome.fontRequested && outcome.fontUsed) {
      disclosures.push(
        `${where}: ${outcome.fontRequested} could not draw the new text, so it was redrawn in ${outcome.fontUsed}.`,
      );
    }
  }
  return disclosures;
}

/**
 * True only when every edit landed and was verified against the output bytes.
 *
 * `partial` deliberately returns false. Downloading a half-edited document
 * without a blocking disclosure is how users end up shipping contracts whose
 * "removed" text is still extractable.
 *
 * `redactionMode` is checked here rather than merely surfaced: a mode other
 * than {@link NON_DESTRUCTIVE_REDACTION_MODE} means content the user never
 * asked to touch was destroyed, which no amount of text-level verification
 * would notice.
 */
export function isServerTextEditTrustworthy(
  report: ServerTextEditReport,
  options: ServerTextEditIdentityOptions = {},
): boolean {
  if (report.status !== 'verified') return false;
  return report.transactionMode === 'atomic'
    && report.engine.transactionMode === 'atomic'
    && report.engine.committed === true
    && typeof report.pdf === 'string'
    && report.pdf.length > 0
    && Number.isInteger(report.pdfSize)
    && Number(report.pdfSize) > 0
    && /^[a-f0-9]{64}$/i.test(report.pdfSha256 ?? '')
    && report.outcomes.length > 0
    && report.outcomes.length === report.engine.editsRequested
    && report.outcomes.every((outcome) => (
      outcome.status === 'applied'
      && outcome.originalRemoved === true
      && outcome.replacementPresent === true
      // An engine too old to report the mode cannot prove it was safe.
      // A true redaction may use the visible-content mode; an ordinary edit
      // may not, because there the user never asked for graphics to vanish.
      && (
        outcome.redactionMode === NON_DESTRUCTIVE_REDACTION_MODE
        || (isRedactionOutcome(outcome, options) && outcome.redactionMode === VISIBLE_REDACTION_MODE)
      )
    ));
}


/** Edits the engine did not apply, for disclosure in the UI. */
export function collectServerTextEditFailures(
  report: ServerTextEditReport,
): ServerTextEditOutcome[] {
  return report.outcomes.filter((outcome) => outcome.status !== 'applied');
}

/** How many edit ids one grouped reason lists before collapsing to a count. */
const MAX_LISTED_FAILURE_IDS = 6;

const NO_REASON_REPORTED = 'The engine reported no reason for this edit.';

/**
 * Contract violations the per-edit reasons do not already account for.
 *
 * {@link isServerTextEditTrustworthy} is one boolean, which is the right shape
 * for the decision and the wrong shape for a bug report: when it says no and
 * every outcome says `applied`, nothing on screen says which of its clauses
 * failed. This names the clause.
 *
 * Conditions that are *expected* of a fail-closed refusal — nothing committed,
 * no bytes, no integrity evidence — are deliberately not defects. Listing them
 * would make every honest refusal also print three alarming lines about missing
 * data, which trains developers to ignore the whole block.
 */
export function collectServerTextEditReportDefects(
  report: ServerTextEditReport,
  options: ServerTextEditIdentityOptions = {},
): string[] {
  const defects: string[] = [];
  if (report.transactionMode !== 'atomic' || report.engine.transactionMode !== 'atomic') {
    defects.push(
      `transactionMode is ${JSON.stringify(report.transactionMode)} (engine: `
      + `${JSON.stringify(report.engine.transactionMode)}); "atomic" is required on both.`,
    );
  }
  if (report.outcomes.length !== report.engine.editsRequested) {
    defects.push(
      `the engine returned ${report.outcomes.length} outcome(s) for `
      + `${report.engine.editsRequested} requested edit(s); every edit must be accounted for.`,
    );
  }
  if (report.status === 'verified') {
    // Only a "verified" report promises committed bytes, so only there is their
    // absence a contradiction rather than the documented refusal shape.
    if (report.engine.committed !== true) {
      defects.push('status is "verified" but engine.committed is not true.');
    }
    if (!report.pdf) {
      defects.push('status is "verified" but no document bytes were returned.');
    }
    if (!Number.isInteger(report.pdfSize) || Number(report.pdfSize) <= 0) {
      defects.push(`pdfSize is ${JSON.stringify(report.pdfSize)}; a positive integer is required.`);
    }
    if (!/^[a-f0-9]{64}$/i.test(report.pdfSha256 ?? '')) {
      defects.push(
        `pdfSha256 is ${JSON.stringify(report.pdfSha256)}; a 64-character hex digest is required.`,
      );
    }
  }
  for (const outcome of report.outcomes) {
    // A non-applied outcome carries a reason, which is reported on its own.
    // These are the silent ones: "applied" without the evidence to back it.
    if (outcome.status !== 'applied') continue;
    const missing: string[] = [];
    if (outcome.originalRemoved !== true) missing.push('originalRemoved is not true');
    if (outcome.replacementPresent !== true) missing.push('replacementPresent is not true');
    if (
      outcome.redactionMode !== NON_DESTRUCTIVE_REDACTION_MODE
      && !(isRedactionOutcome(outcome, options) && outcome.redactionMode === VISIBLE_REDACTION_MODE)
    ) {
      missing.push(
        `redactionMode is ${JSON.stringify(outcome.redactionMode)}, expected `
        + `${JSON.stringify(NON_DESTRUCTIVE_REDACTION_MODE)}`,
      );
    }
    if (missing.length > 0) {
      defects.push(
        `edit ${outcome.id} (page ${outcome.page}) reported "applied" but `
        + `${missing.join('; ')}.`,
      );
    }
  }
  return defects;
}

/** Failed edits that share one verbatim reason. */
export type ServerTextEditFailureGroup = {
  reason: string;
  /** Distinct statuses in this group, so triage can tell pre-flight from post. */
  statuses: ServerTextEditOutcomeStatus[];
  outcomes: ServerTextEditOutcome[];
};

export type ServerTextEditFailureDescription = {
  /** The engine's own verdict, first line of the message. */
  headline: string;
  /** Distinct reasons, rarest first — see the sort note in the function body. */
  groups: ServerTextEditFailureGroup[];
  /** Contract violations from {@link collectServerTextEditReportDefects}. */
  defects: string[];
  /** Headline, then one attributed line per group and per defect. */
  message: string;
};

/**
 * Turn a non-downloadable report into something a developer can act on.
 *
 * The naive rendering — every outcome's `reason` concatenated — is unreadable
 * for the case that matters most. An atomic transaction gives all the
 * collaterally rolled-back edits the *same* sentence, so a 22-edit form
 * produced one real cause followed by 21 identical copies of "Rolled back
 * because another edit in this atomic request failed verification", with
 * nothing saying which edit or which page was at fault.
 *
 * So: group by reason, attribute each group to its edit ids and pages, and put
 * the rarest group first. That ordering is not cosmetic — the collateral
 * sentence is by construction the most repeated one, so rarest-first puts the
 * actual cause on the line under the headline, and the collateral collapses to
 * a single counted line instead of scrolling the cause off screen.
 */
export function describeServerTextEditFailure(
  report: ServerTextEditReport,
  options: ServerTextEditIdentityOptions = {},
): ServerTextEditFailureDescription {
  const byReason = new Map<string, ServerTextEditOutcome[]>();
  for (const outcome of collectServerTextEditFailures(report)) {
    const reason = (outcome.reason ?? '').trim() || NO_REASON_REPORTED;
    const bucket = byReason.get(reason);
    if (bucket) bucket.push(outcome);
    else byReason.set(reason, [outcome]);
  }

  const groups: ServerTextEditFailureGroup[] = [...byReason.entries()]
    .map(([reason, outcomes]) => ({
      reason,
      statuses: [...new Set(outcomes.map((outcome) => outcome.status))],
      outcomes,
    }))
    // Array#sort is stable, so same-sized groups keep request order and the
    // rendered message is deterministic for a given report.
    .sort((left, right) => left.outcomes.length - right.outcomes.length);

  const defects = collectServerTextEditReportDefects(report, options);
  const headline = report.summary.trim()
    || `Text-edit transaction ${report.status}: the document was not exported.`;

  const lines = [headline];
  for (const group of groups) {
    lines.push(`• [${group.statuses.join('/')}] ${describeFailureScope(group.outcomes)}: ${group.reason}`);
  }
  for (const defect of defects) {
    lines.push(`• [contract] ${defect}`);
  }
  if (groups.length === 0 && defects.length === 0) {
    // Reached only if the engine withholds bytes while reporting nothing wrong.
    // Say that plainly rather than showing a bare headline and no cause.
    lines.push(
      '• [contract] the engine returned no usable document and reported no failed '
      + 'edit, so there is no cause to show. Capture the raw response before retrying.',
    );
  }

  return { headline, groups, defects, message: lines.join('\n') };
}

/** `text-2, text-7 (pages 1, 3)` — which edits a grouped reason belongs to. */
function describeFailureScope(outcomes: ServerTextEditOutcome[]): string {
  const pages = [...new Set(outcomes.map((outcome) => outcome.page))].sort((a, b) => a - b);
  const pageLabel = pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.join(', ')}`;
  const ids = outcomes.map((outcome) => outcome.id).filter((id) => id.trim().length > 0);
  if (ids.length === 0) return `${outcomes.length} edit(s) on ${pageLabel}`;
  const hidden = ids.length - MAX_LISTED_FAILURE_IDS;
  const listed = ids.slice(0, MAX_LISTED_FAILURE_IDS).join(', ');
  return `${hidden > 0 ? `${listed} + ${hidden} more` : listed} (${pageLabel})`;
}

/* ── Consent ──────────────────────────────────────────────────────────────── */

/**
 * The engine refuses two kinds of loss until a human accepts them by name.
 * Both refusals *tell the client which flag would lift them*, so the marker we
 * match on is that flag name rather than the surrounding prose — the sentences
 * get reworded, the contract field does not.
 */
const FIDELITY_LOSS_MARKERS = ['acknowledgefidelityloss', 'acknowledge_fidelity_loss'];
const NEIGHBOUR_LOSS_MARKERS = ['allowneighbourloss', 'allow_neighbour_loss'];

/**
 * What the user has to accept before the engine will proceed.
 *
 * Recorded rather than inferred, and kept as narrow as the engine's own
 * refusal: granting one box's neighbour loss must not quietly authorise
 * deletion inside every other box.
 */
export type ServerTextEditConsentRequest = {
  /**
   * Accept that editing rewrites the whole file — decrypting an encrypted
   * document, invalidating any signature. Document-wide because the engine
   * refuses the file before it looks at any individual edit.
   */
  acknowledgeFidelityLoss: boolean;
  /**
   * Edit ids the engine refused because their box also covers text
   * `originalText` does not name. Per-edit on purpose (see above).
   */
  allowNeighbourLossEditIds: string[];
  /** The engine's own sentences, deduplicated, in the order first seen. */
  reasons: string[];
};

/**
 * Decide whether a refusal is one the user can lift, and what it would cost.
 *
 * Both refusal shapes have to be recognised, because they arrive by different
 * routes:
 *
 * - **Fidelity loss** is raised before any edit is examined, so it comes back as
 *   `StructuralTextEditError` → HTTP 400 `{ error }` with **no report**.
 * - **Neighbour loss** is a per-edit guard, so it comes back as HTTP 200 with a
 *   `refused` report whose outcomes carry the reason.
 *
 * Returns `null` when the refusal is not consent-recoverable — a corrupt file,
 * an unreachable service, a contract violation. Those must stay refusals: the
 * point of this function is to unblock the two cases the engine explicitly
 * offers to proceed on, not to add a "try harder" button to every failure.
 */
export function classifyServerTextEditConsent(
  input: { error?: string | null; report?: ServerTextEditReport | null },
): ServerTextEditConsentRequest | null {
  const reasons: string[] = [];
  let acknowledgeFidelityLoss = false;
  const allowNeighbourLossEditIds: string[] = [];

  const note = (text: string | null | undefined) => {
    const trimmed = (text ?? '').trim();
    if (trimmed && !reasons.includes(trimmed)) reasons.push(trimmed);
  };

  const scan = (text: string | null | undefined, editId?: string) => {
    const haystack = (text ?? '').toLowerCase();
    if (!haystack) return;
    if (FIDELITY_LOSS_MARKERS.some((marker) => haystack.includes(marker))) {
      acknowledgeFidelityLoss = true;
      note(text);
    }
    if (NEIGHBOUR_LOSS_MARKERS.some((marker) => haystack.includes(marker))) {
      // Without an id there is no edit to attach the grant to. Recording the
      // reason without the grant keeps the message honest and leaves the export
      // refused, which is the correct outcome for an unattributable guard.
      if (editId) allowNeighbourLossEditIds.push(editId);
      note(text);
    }
  };

  scan(input.error);
  scan(input.report?.summary);
  for (const outcome of input.report?.outcomes ?? []) {
    if (outcome.status === 'applied') continue;
    scan(outcome.reason, outcome.id);
  }

  if (!acknowledgeFidelityLoss && allowNeighbourLossEditIds.length === 0) return null;
  return { acknowledgeFidelityLoss, allowNeighbourLossEditIds, reasons };
}

/**
 * Combine an earlier grant with a newly requested one.
 *
 * Needed because the two gates fire in sequence, not together: an encrypted
 * document is refused for fidelity before any edit is inspected, so the
 * neighbour guard can only surface on the retry. Dropping the first grant there
 * would loop the user between two dialogs forever.
 */
export function mergeServerTextEditConsent(
  previous: ServerTextEditConsentRequest | null | undefined,
  next: ServerTextEditConsentRequest,
): ServerTextEditConsentRequest {
  if (!previous) return next;
  return {
    acknowledgeFidelityLoss: previous.acknowledgeFidelityLoss || next.acknowledgeFidelityLoss,
    allowNeighbourLossEditIds: [...new Set([
      ...previous.allowNeighbourLossEditIds,
      ...next.allowNeighbourLossEditIds,
    ])],
    reasons: [...new Set([...previous.reasons, ...next.reasons])],
  };
}

/** The grants that apply to one edit, ready for {@link toServerTextEditRequest}. */
export function serverTextEditConsentFor(
  consent: ServerTextEditConsentRequest | null | undefined,
  editId: string,
): ToServerTextEditOptions {
  if (!consent) return {};
  return {
    ...(consent.acknowledgeFidelityLoss ? { acknowledgeFidelityLoss: true } : {}),
    ...(consent.allowNeighbourLossEditIds.includes(editId) ? { allowNeighbourLoss: true } : {}),
  };
}

/**
 * Render a consent request as the impact dialog the editor already has.
 *
 * Reusing {@link PdfExportImpact} rather than inventing a second confirmation
 * mechanism means `PdfExportImpactDialog` renders this unchanged, and the
 * existing `isConfirmedExportMode` check keeps governing the retry. The
 * `decision` is the real export decision so a confirmation cannot be replayed
 * against a different mode than the one the user was shown.
 *
 * The engine's verbatim reasons are quoted, not paraphrased. They name the page,
 * the edit, and — for the neighbour guard — the exact text that would be
 * deleted, which is the only thing that makes this an informed decision rather
 * than a scary dialog the user clicks through.
 */
export function buildServerTextEditConsentImpact(
  consent: ServerTextEditConsentRequest,
  decision: PdfEditorExportDecision,
): PdfExportImpact {
  const consequences: PdfExportConsequence[] = [];

  if (consent.acknowledgeFidelityLoss) {
    consequences.push({
      id: 'server-text-edit-fidelity-loss',
      severity: 'critical',
      title: 'The file is rewritten, so protection and signatures do not survive',
      detail:
        'Editing text rewrites the document. An encrypted document is written back '
        + 'decrypted — its open or permissions password is gone — and any digital '
        + 'signature becomes invalid because the bytes it signed no longer exist. '
        + 'The original file on your disk is not modified.',
    });
  }

  if (consent.allowNeighbourLossEditIds.length > 0) {
    const count = consent.allowNeighbourLossEditIds.length;
    consequences.push({
      id: 'server-text-edit-neighbour-loss',
      severity: 'critical',
      title: `Text inside ${count} edit box${count === 1 ? '' : 'es'} will be deleted with nothing put back`,
      detail:
        `${count} edit box${count === 1 ? ' covers' : 'es cover'} characters beyond the text being `
        + 'replaced. Removing the old glyphs deletes those characters too, and nothing '
        + 'is written in their place. This loss is permanent and no later '
        + 'verification step can detect it. Cancel and shrink the box instead if the '
        + 'quoted text should stay.',
    });
  }

  for (const [index, reason] of consent.reasons.entries()) {
    consequences.push({
      id: `server-text-edit-consent-reason-${index + 1}`,
      severity: 'warning',
      title: 'The engine reported',
      detail: reason,
    });
  }

  const title = consent.acknowledgeFidelityLoss && consent.allowNeighbourLossEditIds.length > 0
    ? 'Editing this document loses protection and deletes unnamed text'
    : consent.acknowledgeFidelityLoss
      ? 'Editing this document removes its protection'
      : 'Editing deletes text you did not name';

  return {
    decision,
    severity: 'critical',
    requiresConfirmation: true,
    title,
    summary:
      'The text engine refused this export rather than cause loss you had not agreed to. '
      + 'Read what it would cost, then either accept it explicitly or cancel — nothing '
      + 'has been written yet.',
    consequences,
    preservationNotes: [
      'Nothing has been changed so far: the engine refused before writing anything.',
      'Your original file is never modified — the export always produces a new document.',
      'Only the loss listed above is accepted. Every other guarantee still applies, and '
      + 'the export is still verified against the produced bytes before you get it.',
    ],
    confirmLabel: 'Accept this loss and export',
  };
}

function decodeBase64Pdf(base64: string): Uint8Array {
  // Node (tests, SSR) and the browser disagree on which primitive exists.
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  const nodeBuffer = (globalThis as { Buffer?: { from(data: string, enc: string): Uint8Array } })
    .Buffer;
  if (nodeBuffer) return new Uint8Array(nodeBuffer.from(base64, 'base64'));
  throw new Error('No base64 decoder available in this runtime.');
}

/** Narrow an untyped JSON body into a report, or explain why it is not one. */
export function parseServerTextEditReport(
  body: unknown,
): { ok: true; report: ServerTextEditReport } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'The text-edit service returned a malformed response.' };
  }
  const candidate = body as Partial<ServerTextEditReport> & { error?: unknown };

  // The route surfaces validation problems as `{ error }` with no report.
  if (typeof candidate.error === 'string' && !candidate.status) {
    return { ok: false, error: candidate.error };
  }

  const status = candidate.status;
  if (status !== 'verified' && status !== 'partial' && status !== 'refused') {
    return {
      ok: false,
      error: 'The text-edit service did not report a recognisable status.',
    };
  }

  if (candidate.contractVersion !== 1 || candidate.transactionMode !== 'atomic') {
    return { ok: false, error: 'The text-edit service returned an unsupported transaction contract.' };
  }
  if (typeof candidate.summary !== 'string' || !Array.isArray(candidate.outcomes)) {
    return { ok: false, error: 'The text-edit service returned an incomplete edit report.' };
  }
  const outcomes: ServerTextEditOutcome[] = [];
  for (const raw of candidate.outcomes) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'The text-edit service returned a malformed edit outcome.' };
    }
    const outcome = raw as Partial<ServerTextEditOutcome>;
    if (typeof outcome.id !== 'string' || !outcome.id.trim()
      || !Number.isInteger(outcome.page) || Number(outcome.page) < 1
      || (outcome.status !== 'applied' && outcome.status !== 'refused' && outcome.status !== 'unverified')) {
      return { ok: false, error: 'The text-edit service returned a malformed edit outcome.' };
    }
    outcomes.push(outcome as ServerTextEditOutcome);
  }
  const engine = candidate.engine;
  if (!engine || typeof engine !== 'object'
    || engine.transactionMode !== 'atomic'
    || typeof engine.committed !== 'boolean'
    || !Number.isInteger(engine.editsRequested)
    || engine.editsRequested < 1) {
    return { ok: false, error: 'The text-edit service returned incomplete transaction evidence.' };
  }
  if (outcomes.length !== engine.editsRequested) {
    return { ok: false, error: 'The text-edit service did not report every requested edit.' };
  }
  if (status === 'verified' && (!engine.committed || outcomes.length === 0
    || outcomes.some((outcome) => outcome.status !== 'applied'
      || outcome.originalRemoved !== true
      || outcome.replacementPresent !== true))) {
    return { ok: false, error: 'The text-edit service returned inconsistent verification evidence.' };
  }
  if (status === 'refused' && (engine.committed || typeof candidate.pdf === 'string')) {
    return { ok: false, error: 'The text-edit service returned bytes for a refused transaction.' };
  }
  if (status === 'partial') {
    return { ok: false, error: 'Partial structural text-edit transactions are not supported.' };
  }

  return {
    ok: true,
    report: {
      contractVersion: 1,
      transactionMode: 'atomic',
      status,
      summary: candidate.summary,
      outcomes,
      pdf: typeof candidate.pdf === 'string' ? candidate.pdf : null,
      filename: typeof candidate.filename === 'string' ? candidate.filename : undefined,
      pdfSize: Number.isInteger(candidate.pdfSize) && Number(candidate.pdfSize) >= 0
        ? Number(candidate.pdfSize)
        : null,
      pdfSha256: typeof candidate.pdfSha256 === 'string' ? candidate.pdfSha256 : null,
      engine,
    },
  };
}

export type ServerTextEditTransport = (
  endpoint: string,
  body: FormData,
) => Promise<{ status: number; json: () => Promise<unknown> }>;

const defaultTransport: ServerTextEditTransport = (endpoint, body) =>
  fetch(endpoint, { method: 'POST', body });

export type ApplyServerTextEditsInput = {
  source: ArrayBuffer | Uint8Array;
  edits: ServerTextEditRequest[];
  filename?: string;
  transport?: ServerTextEditTransport;
  endpoint?: string;
};

/**
 * Send edits to the engine and translate the answer into a decision.
 *
 * Returns `ok: false` for anything that is not a complete atomic report: an
 * empty edit list, transport failure, malformed body, mismatched edit set, or
 * failed PDF integrity check. A refusal is the only non-downloadable `ok: true`
 * result because it is an intentional, fully described fail-closed decision.
 */
export async function applyServerTextEdits(
  input: ApplyServerTextEditsInput,
): Promise<ServerTextEditResult> {
  if (input.edits.length === 0) {
    return { ok: false, error: 'No text edits to apply.' };
  }
  const expectedIds = input.edits.map((edit) => edit.id);
  if (expectedIds.some((id) => !id.trim()) || new Set(expectedIds).size !== expectedIds.length) {
    return { ok: false, error: 'Every text edit must have a unique non-empty id.' };
  }

  const bytes =
    input.source instanceof Uint8Array ? input.source : new Uint8Array(input.source);
  const form = new FormData();
  // `slice()` detaches the view from any larger buffer so Blob copies exactly
  // the document bytes and nothing adjacent to them.
  form.append(
    'file',
    new Blob([bytes.slice()], { type: 'application/pdf' }),
    input.filename ?? 'document.pdf',
  );
  form.append('edits', JSON.stringify(input.edits));

  const transport = input.transport ?? defaultTransport;
  const endpoint = input.endpoint ?? SERVER_TEXT_EDIT_ENDPOINT;

  let response: { status: number; json: () => Promise<unknown> };
  try {
    response = await transport(endpoint, form);
  } catch {
    return {
      ok: false,
      error:
        'Could not reach the text-edit service. No changes were applied to the document.',
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: 'The text-edit service returned an unreadable response.' };
  }

  const parsed = parseServerTextEditReport(body);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { report } = parsed;
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, error: report.summary || `The text-edit service failed with HTTP ${response.status}.`, report };
  }
  const actualIds = report.outcomes.map((outcome) => outcome.id);
  if (actualIds.length !== expectedIds.length
    || new Set(actualIds).size !== actualIds.length
    || expectedIds.some((id) => !actualIds.includes(id))) {
    return { ok: false, error: 'The text-edit service response did not match the requested edit set.', report };
  }

  if (report.status === 'refused') {
    // A refusal is a correct answer, not an error: the engine declined rather
    // than fake the edit. Surface its own summary so the user learns why.
    return { ok: true, report, pdfBytes: null };
  }

  if (!report.pdf) {
    return {
      ok: false,
      error: 'The text-edit service reported success but returned no document.',
      report,
    };
  }

  try {
    const pdfBytes = decodeBase64Pdf(report.pdf);
    const header = new TextDecoder('ascii').decode(pdfBytes.slice(0, 5));
    const trailer = new TextDecoder('ascii').decode(pdfBytes.slice(Math.max(0, pdfBytes.length - 1024)));
    if (header !== '%PDF-' || !trailer.includes('%%EOF')) {
      return { ok: false, error: 'The text-edit service returned bytes that are not a complete PDF.', report };
    }
    if (report.pdfSize !== pdfBytes.byteLength || !/^[a-f0-9]{64}$/i.test(report.pdfSha256 ?? '')) {
      return { ok: false, error: 'The text-edit service returned incomplete PDF integrity evidence.', report };
    }
    const hash = await crypto.subtle.digest('SHA-256', pdfBytes.slice());
    const sha256 = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (sha256.toLowerCase() !== report.pdfSha256?.toLowerCase()) {
      return { ok: false, error: 'The edited PDF failed its integrity check.', report };
    }
    return { ok: true, report, pdfBytes };
  } catch {
    return {
      ok: false,
      error: 'The edited document could not be decoded.',
      report,
    };
  }
}
