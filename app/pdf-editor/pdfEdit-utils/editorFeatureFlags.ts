/**
 * Editor feature flags.
 *
 * Delivery rule #3 requires every major capability to ship additively, behind a
 * flag, so a regression in new work can be switched off without reverting the
 * release or stranding a user mid-document. Phase 3 page operations are the
 * first capability that changes what `exportPdf` actually does, so the flag has
 * to exist before the wiring, not after it.
 *
 * Design constraints:
 *
 * - Resolution is pure and synchronous. A flag read happens during render and
 *   inside export decisions; an async read would create a window where the
 *   editor does not know which export path it is on.
 * - Unknown and malformed values are not errors. A typo in an env var must not
 *   break the editor, it must fall back to the documented default.
 * - Defaults are declared per flag rather than "off for everything", because a
 *   flag protecting a *safety* behaviour (the export gate) must default ON while
 *   a flag exposing new *surface* (page tools) can default however the rollout
 *   needs.
 *
 * Deliberately not a React context: flags are read by pure export logic in
 * `editorPageSession`, which must stay testable without a renderer.
 */

export type PdfEditorFeatureFlag =
  /** Phase 3: page organizer UI and page operations in the editor. */
  | 'pageOperations'
  /**
   * Phase 3D: route page exports through the enforcement gate. Separate from
   * `pageOperations` so the gate can be verified in isolation, and so the gate
   * can never be disabled *by* enabling page tools.
   */
  | 'pageExportGate'
  /**
   * W2: refuse text edits whose script `drawText` cannot lay out correctly
   * (Bengali, Devanagari, Arabic, Thai, ...). Off means reverting to the old
   * behaviour of writing `?` placeholders or misordered glyphs silently.
   */
  | 'textShapingGuard'
  /**
   * S3: route text edits through the server engine that *removes* the original
   * glyphs from the content stream instead of painting a rectangle over them.
   * Requires the PDF microservice to be reachable. Export fails closed when it
   * is unavailable; it must never silently fall back to cover-and-retype.
   */
  | 'serverTextEdit'
  /**
   * W2: write canvas text/shapes/freehand marks as real PDF objects with an
   * embedded font. Unsupported objects keep the existing raster overlay for
   * that page and are disclosed. Off restores the all-raster overlay path.
   */
  | 'vectorCanvasExport'
  /**
   * W3: author real redactions and send them through the removal engine. Off
   * hides the redact tool and ignores saved marks; no local cover-up path is
   * substituted for real removal.
   */
  | 'redactionAuthoring';


export type PdfEditorFeatureFlagState = Readonly<Record<PdfEditorFeatureFlag, boolean>>;

/** Env var that overrides each flag. Public prefix: read in the browser bundle. */
const FLAG_ENV_KEYS: Readonly<Record<PdfEditorFeatureFlag, string>> = {
  pageOperations: 'NEXT_PUBLIC_PDF_EDITOR_PAGE_OPERATIONS',
  pageExportGate: 'NEXT_PUBLIC_PDF_EDITOR_PAGE_EXPORT_GATE',
  textShapingGuard: 'NEXT_PUBLIC_PDF_EDITOR_TEXT_SHAPING_GUARD',
  serverTextEdit: 'NEXT_PUBLIC_PDF_EDITOR_SERVER_TEXT_EDIT',
  vectorCanvasExport: 'NEXT_PUBLIC_PDF_EDITOR_VECTOR_CANVAS_EXPORT',
  redactionAuthoring: 'NEXT_PUBLIC_PDF_EDITOR_REDACTION_AUTHORING',
};


/**
 * `pageExportGate` defaults on: an export that silently skips disclosure is a
 * data-loss bug, so the safe state is "enforced" even if configuration is
 * missing entirely. `pageOperations` also defaults on now that the page plan is
 * wired end to end, but it stays separately switchable for incident response.
 */
const FLAG_DEFAULTS: PdfEditorFeatureFlagState = {
  pageOperations: true,
  pageExportGate: true,
  textShapingGuard: true,
  serverTextEdit: true,
  vectorCanvasExport: true,
  redactionAuthoring: true,
};


const TRUE_VALUES = new Set(['1', 'true', 'on', 'yes', 'enabled']);
const FALSE_VALUES = new Set(['0', 'false', 'off', 'no', 'disabled']);

/**
 * Tri-state parse: `null` means "said nothing usable", which is different from
 * "said false". Only an explicit, recognised value may override a default.
 */
export function parsePdfEditorFeatureFlagValue(raw: string | undefined | null): boolean | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (value === '') return null;
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  return null;
}

export type PdfEditorFeatureFlagSource = Readonly<Record<string, string | undefined>>;

/**
 * Resolve flags from an env-like record. The source is a parameter so tests do
 * not mutate `process.env`, and so a server-rendered value can be handed to the
 * client without re-reading the environment.
 */
export function resolvePdfEditorFeatureFlags(
  source?: PdfEditorFeatureFlagSource,
): PdfEditorFeatureFlagState {
  const env: PdfEditorFeatureFlagSource =
    source ?? (typeof process !== 'undefined' && process.env ? process.env : {});

  const resolved = {} as Record<PdfEditorFeatureFlag, boolean>;
  for (const flag of Object.keys(FLAG_DEFAULTS) as PdfEditorFeatureFlag[]) {
    const override = parsePdfEditorFeatureFlagValue(env[FLAG_ENV_KEYS[flag]]);
    resolved[flag] = override ?? FLAG_DEFAULTS[flag];
  }
  return resolved;
}

export function isPdfEditorFeatureEnabled(
  flag: PdfEditorFeatureFlag,
  flags?: PdfEditorFeatureFlagState,
): boolean {
  return (flags ?? resolvePdfEditorFeatureFlags())[flag];
}

/** Defaults exposed for tests and for documenting rollout state. */
export function getPdfEditorFeatureFlagDefaults(): PdfEditorFeatureFlagState {
  return FLAG_DEFAULTS;
}
