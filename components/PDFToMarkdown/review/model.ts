/** Mr. Markdown-only, opt-in pilot. No shared registry or access-policy change. */
export const REVIEW_PILOT_ENABLED = process.env.NEXT_PUBLIC_MR_MARKDOWN_REVIEW === 'true'

export type ReviewPage = {
  page_number: number
  method: string
  classification: string
  confidence: number | null
  ocr_attempted: boolean
  warnings: string[]
}

export type ExtractionReview = {
  version: 1
  source: { name: string; size: number; sha256: string | null }
  capturedAt: number
  revision: number
  acknowledged: string[]
  diagnosticsAvailable: boolean
  diagnosticsComplete: boolean
  pages: ReviewPage[]
  warnings: string[]
  imageCount: number | null
}

export type ReviewIssue = {
  id: string
  page: number | null
  status: 'warning' | 'failed' | 'not_checked'
  title: string
  detail: string
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
const strings = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.slice(0, 128).filter((item): item is string => typeof item === 'string' && !!item.trim()).map((item) => item.slice(0, 500)))].slice(0, 32)
  : []

const WARNING_COPY: Record<string, string> = {
  automatic_ocr_fallback: 'The processor flagged an automatic fallback from native text. Compare the result with this source page.',
  native_text_low_quality: 'Native text was reported as low quality. Check characters, names, numbers and reading order.',
  ocr_empty: 'The OCR path returned no text. This page may need manual transcription.',
  ocr_unavailable: 'OCR was reported as unavailable. Scanned text may be missing from the output.',
  ocr_empty_native_fallback: 'The OCR path returned no text and native text was used instead. Inspect this page carefully.',
}
const describeWarning = (warning: string): string => Object.hasOwn(WARNING_COPY, warning) ? WARNING_COPY[warning] : warning

function readPages(value: unknown): { pages: ReviewPage[]; complete: boolean } {
  if (!Array.isArray(value)) return { pages: [], complete: false }
  const pages: ReviewPage[] = []
  const seen = new Set<number>()
  let characters = 0
  let complete = value.length <= 1_000
  for (const item of value.slice(0, 1_000)) {
    const source = record(item)
    const page = count(source.page_number)
    if (!page || seen.has(page)) { complete = false; continue }
    const warnings = strings(source.warnings)
    if (Array.isArray(source.warnings) && JSON.stringify(warnings) !== JSON.stringify(source.warnings)) complete = false
    const candidate: ReviewPage = {
      page_number: page,
      method: typeof source.method === 'string' ? source.method.slice(0, 80) : 'unknown',
      classification: typeof source.classification === 'string' ? source.classification.slice(0, 80) : 'unknown',
      confidence: typeof source.confidence === 'number' && Number.isFinite(source.confidence) && source.confidence >= 0 && source.confidence <= 100 ? source.confidence : null,
      ocr_attempted: source.ocr_attempted === true,
      warnings,
    }
    characters += JSON.stringify(candidate).length
    if (characters > 48_000 || pages.length >= 1_000) { complete = false; break }
    seen.add(page)
    pages.push(candidate)
  }
  return { pages, complete }
}

export function createExtractionReview(payload: unknown, source: ExtractionReview['source'], capturedAt = Date.now()): ExtractionReview {
  const data = record(payload)
  const extraction = record(data.extraction)
  const available = extraction.schema_version === 'pdf-to-markdown.extraction/v1' && Array.isArray(extraction.pages) && extraction.pages.length > 0
  const parsed = available ? readPages(extraction.pages) : { pages: [], complete: false }
  const warnings = strings(data.warnings)
  return {
    version: 1, source, capturedAt, revision: 0, acknowledged: [],
    diagnosticsAvailable: available,
    diagnosticsComplete: parsed.complete && (!Array.isArray(data.warnings) || JSON.stringify(warnings) === JSON.stringify(data.warnings)),
    pages: parsed.pages, warnings, imageCount: count(data.images),
  }
}

/** Persist only bounded metadata, never PDF bytes, passwords or generated HTML. */
export function restoreExtractionReview(value: unknown): ExtractionReview | undefined {
  const data = record(value)
  const source = record(data.source)
  if (data.version !== 1 || typeof source.name !== 'string' || count(source.size) === null) return undefined
  const parsed = readPages(data.pages)
  const review: ExtractionReview = {
    version: 1,
    source: {
      name: source.name.slice(0, 500), size: count(source.size)!,
      sha256: typeof source.sha256 === 'string' && /^[a-f0-9]{64}$/.test(source.sha256) ? source.sha256 : null,
    },
    capturedAt: count(data.capturedAt) ?? 0,
    revision: count(data.revision) ?? 0,
    acknowledged: [],
    diagnosticsAvailable: data.diagnosticsAvailable === true && parsed.pages.length > 0,
    diagnosticsComplete: data.diagnosticsComplete === true && parsed.complete && parsed.pages.length > 0,
    pages: parsed.pages, warnings: strings(data.warnings), imageCount: count(data.imageCount),
  }
  const known = new Set(reviewIssues(review).map((issue) => issue.id))
  review.acknowledged = Array.isArray(data.acknowledged)
    ? [...new Set(data.acknowledged.filter((id): id is string => typeof id === 'string' && known.has(id)))]
    : []
  return review
}

export function reviseExtractionReview(review: ExtractionReview, before: string, after: string): ExtractionReview {
  return before === after ? review : { ...review, revision: review.revision + 1, acknowledged: [] }
}

export function acknowledgeReview(review: ExtractionReview, id: string, revision: number, checked: boolean): ExtractionReview {
  if (revision !== review.revision || !reviewIssues(review).some((issue) => issue.id === id)) return review
  const acknowledged = review.acknowledged.filter((current) => current !== id)
  if (checked) acknowledged.push(id)
  return { ...review, acknowledged }
}

export function reviewIssues(review: ExtractionReview): ReviewIssue[] {
  const issues: ReviewIssue[] = []
  const pageWarnings = new Set<string>()
  for (const page of review.pages) {
    for (const [index, warning] of page.warnings.entries()) {
      pageWarnings.add(warning)
      issues.push({ id: `page-${page.page_number}-warning-${index}`, page: page.page_number, status: 'warning', title: 'Extraction notice', detail: describeWarning(warning) })
    }
    if (page.method === 'unavailable') issues.push({ id: `page-${page.page_number}-unavailable`, page: page.page_number, status: 'failed', title: 'Text extraction unavailable', detail: 'This page needs manual inspection. Acknowledging this notice does not recover missing content.' })
    else if (page.method === 'ocr' || page.ocr_attempted) issues.push({ id: `page-${page.page_number}-ocr`, page: page.page_number, status: 'not_checked', title: 'Review OCR / fallback output', detail: 'The processor reported OCR or fallback activity. This diagnostic is not proof of which engine ran. Compare names, numbers and reading order with the original.' })
  }
  review.warnings.forEach((warning, index) => {
    if (!pageWarnings.has(warning)) issues.push({ id: `warning-${index}`, page: null, status: 'warning', title: 'Conversion notice', detail: describeWarning(warning) })
  })
  if (!review.diagnosticsAvailable || !review.diagnosticsComplete) issues.unshift({ id: 'diagnostics-incomplete', page: null, status: 'not_checked', title: 'Limited extraction diagnostics', detail: 'The response did not include all supported diagnostic details. This review cannot establish extraction completeness.' })
  if (review.imageCount) issues.push({ id: 'image-delivery', page: null, status: 'not_checked', title: 'Check figures in the delivered file', detail: `${review.imageCount} image asset(s) were reported. Image references alone do not prove that their binaries are included in an export.` })
  issues.push(
    { id: 'names-numbers', page: null, status: 'not_checked', title: 'Compare names, dates and numbers', detail: 'These values are not automatically verified against the PDF. Review them before using the draft.' },
    { id: 'layout-content', page: null, status: 'not_checked', title: 'Check completeness and reading order', detail: 'Compare all selected pages, tables and figures with the original. A high heuristic score does not establish correctness.' },
  )
  return issues
}

export async function sha256Bytes(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Source fingerprinting requires a secure browser context.')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function matchesReviewSource(file: File, source: ExtractionReview['source']): Promise<boolean> {
  if (!source.sha256 || file.size !== source.size) return false
  return await sha256Bytes(await file.arrayBuffer()) === source.sha256
}

export async function createReviewReport(review: ExtractionReview, markdown: string, sourceAvailable: boolean) {
  return {
    schema: 'mr-markdown.review/v1',
    exported_at: new Date().toISOString(),
    source: review.source,
    source_available: sourceAvailable,
    document: { revision: review.revision, markdown_sha256: await sha256Bytes(new TextEncoder().encode(markdown).buffer) },
    diagnostics_complete: review.diagnosticsComplete,
    pages: review.pages,
    checks: reviewIssues(review).map((issue) => ({ ...issue, reviewer_acknowledged: sourceAvailable && review.acknowledged.includes(issue.id) })),
    limitations: [
      'Reviewer acknowledgements are not automatic verification or certification.',
      'This report identifies the current Markdown snapshot, not the correctness of a PDF or DOCX export.',
      'Word-level and table-cell source mapping, numeric accuracy and semantic completeness are not automatically checked.',
    ],
  }
}
