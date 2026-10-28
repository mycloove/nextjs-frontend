import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  acknowledgeReview, createExtractionReview, createReviewReport, matchesReviewSource,
  restoreExtractionReview, reviseExtractionReview, reviewIssues, sha256Bytes,
} from './model.ts'
import { hydrateJob, serializeSession } from '../session.ts'
import { computeStats, type Job } from '../utils.ts'

const source = { name: 'report.pdf', size: 14, sha256: 'a'.repeat(64) }
const payload = {
  images: 2,
  warnings: ['Native text unavailable'],
  extraction: {
    schema_version: 'pdf-to-markdown.extraction/v1',
    pages: [
      { page_number: 3, method: 'ocr', classification: 'scanned', confidence: 92, ocr_attempted: true, warnings: ['Native text unavailable'] },
      { page_number: 7, method: 'unavailable', classification: 'low_quality', confidence: 0, ocr_attempted: true, warnings: [] },
    ],
  },
}

test('keeps actual source page numbers for a noncontiguous extraction', () => {
  const review = createExtractionReview(payload, source, 100)
  assert.deepEqual(review.pages.map((page) => page.page_number), [3, 7])
  assert.equal(review.diagnosticsAvailable, true)
  assert.equal(review.diagnosticsComplete, true)
  assert.equal(review.pages[1].confidence, 0)
  const issues = reviewIssues(review)
  assert.equal(issues.filter((issue) => issue.detail === 'Native text unavailable').length, 1)
  assert.ok(issues.some((issue) => issue.page === 7 && issue.status === 'failed'))
  assert.ok(issues.some((issue) => issue.id === 'image-delivery' && issue.status === 'not_checked'))
})

test('missing or unknown diagnostics remain unverified without fabricated pages', () => {
  for (const response of [null, {}, { extraction: { schema_version: 'future/v2', pages: payload.extraction.pages } }, { extraction: { schema_version: 'pdf-to-markdown.extraction/v1', pages: [] } }]) {
    const review = createExtractionReview(response, source)
    assert.equal(review.diagnosticsAvailable, false)
    assert.deepEqual(review.pages, [])
    assert.ok(reviewIssues(review).some((issue) => issue.id === 'diagnostics-incomplete'))
  }
})

test('unknown warning codes remain plain text, including prototype names', () => {
  const review = createExtractionReview({ warnings: ['__proto__', 'constructor', 'ocr_unavailable'] }, source)
  const notices = reviewIssues(review).filter((issue) => issue.id.startsWith('warning-'))
  assert.deepEqual(notices.slice(0, 2).map((issue) => issue.detail), ['__proto__', 'constructor'])
  assert.match(notices[2].detail, /OCR was reported as unavailable/)
})

test('rejects invalid page numbers and invalid confidence rather than guessing', () => {
  const review = createExtractionReview({ extraction: { schema_version: 'pdf-to-markdown.extraction/v1', pages: [
    { page_number: 0 }, { page_number: -1 }, { page_number: '4' },
    { page_number: 4, confidence: 200, method: 'native' }, { page_number: 4 },
  ] } }, source)
  assert.deepEqual(review.pages.map((page) => page.page_number), [4])
  assert.equal(review.pages[0].confidence, null)
  assert.equal(review.diagnosticsComplete, false)
})

test('bounds saved diagnostics and discloses incomplete coverage', () => {
  const pages = Array.from({ length: 2000 }, (_, index) => ({ page_number: index + 1, method: 'ocr', warnings: ['x'.repeat(500)] }))
  const review = createExtractionReview({ extraction: { schema_version: 'pdf-to-markdown.extraction/v1', pages } }, source)
  assert.ok(review.pages.length < pages.length)
  assert.ok(JSON.stringify(review).length < 50_000)
  assert.equal(review.diagnosticsComplete, false)
})

test('any actual edit invalidates acknowledgements, including edit-and-undo', () => {
  const review = createExtractionReview(payload, source)
  const acknowledged = acknowledgeReview(review, 'names-numbers', 0, true)
  assert.deepEqual(acknowledged.acknowledged, ['names-numbers'])
  assert.equal(reviseExtractionReview(acknowledged, 'same', 'same'), acknowledged)
  const changed = reviseExtractionReview(acknowledged, 'old', 'new')
  assert.deepEqual(changed.acknowledged, [])
  assert.equal(changed.revision, 1)
  assert.equal(acknowledgeReview(changed, 'names-numbers', 0, true), changed)
  assert.equal(acknowledgeReview(changed, 'invented-check', 1, true), changed)
  const undone = reviseExtractionReview(changed, 'new', 'old')
  assert.equal(undone.revision, 2)
  assert.deepEqual(undone.acknowledged, [])
})

test('source identity requires exact bytes, not matching name or size', async () => {
  const original = new File(['first source'], 'document.pdf')
  const fingerprint = { name: original.name, size: original.size, sha256: await sha256Bytes(await original.arrayBuffer()) }
  assert.equal(await matchesReviewSource(new File(['other source'], 'document.pdf'), fingerprint), false)
  assert.equal(await matchesReviewSource(new File(['first source'], 'renamed.pdf'), fingerprint), true)
  assert.equal(await matchesReviewSource(original, { ...fingerprint, sha256: null }), false)
})

test('restores only bounded supported metadata, never PDF bytes or passwords', () => {
  const review = createExtractionReview(payload, source)
  const restored = restoreExtractionReview({ ...review, acknowledged: ['names-numbers', 'invented'], password: 'secret', sourcePdf: 'not-persistable' })!
  assert.deepEqual(restored.acknowledged, ['names-numbers'])
  assert.equal('password' in restored, false)
  assert.equal('sourcePdf' in restored, false)
  assert.equal(restoreExtractionReview({ version: 9 }), undefined)
  assert.equal(restoreExtractionReview({ ...review, source: { ...source, sha256: 'bad' } })?.source.sha256, null)
})

test('review report binds the Markdown snapshot and never upgrades notices to passed', async () => {
  const review = acknowledgeReview(createExtractionReview(payload, source), 'names-numbers', 0, true)
  const report = await createReviewReport(review, '# Exact draft\n', true)
  assert.equal(report.document.markdown_sha256, await sha256Bytes(new TextEncoder().encode('# Exact draft\n').buffer))
  assert.ok(report.checks.some((issue) => issue.id === 'names-numbers' && issue.status === 'not_checked' && issue.reviewer_acknowledged))
  assert.ok(report.checks.some((issue) => issue.status === 'failed'))
  const detached = await createReviewReport(review, '# Exact draft\n', false)
  assert.ok(detached.checks.every((issue) => !issue.reviewer_acknowledged))
})

test('session roundtrip keeps review metadata but requires source reattachment', () => {
  const file = new File(['PDF source bytes'], 'original.pdf', { type: 'application/pdf' })
  const job: Job = {
    id: 'job', file, sourcePdf: file, title: 'Draft', status: 'done', progress: 100,
    markdown: '# Draft', html: '<h1>Draft</h1>', stats: computeStats('# Draft'), confidence: 90,
    password: 'must-not-persist', passwordAttempts: 0, aiActions: {},
    extractionReview: createExtractionReview(payload, source),
  }
  const { session } = serializeSession({ jobs: [job], activeJobId: job.id, view: 'workspace', newDocumentMode: false, focusMode: false,
    options: { mode: 'standard', bijoy: false, bilingual: false, pageRange: '', language: 'auto', activePreset: null },
  })
  const stored = JSON.stringify(session)
  assert.doesNotMatch(stored, /must-not-persist|PDF source bytes|sourcePdf/)
  const restored = hydrateJob(JSON.parse(stored).docs[0])
  assert.deepEqual(restored.extractionReview, job.extractionReview)
  assert.equal(restored.sourcePdf, undefined)
  assert.equal(restored.password, undefined)
  assert.equal(restored.markdown, '# Draft')
  assert.equal(restored.file.type, 'text/markdown')
})

test('older saved documents hydrate without inventing a source review', () => {
  const job = hydrateJob({ id: 'old', title: 'Old draft', sourceName: 'old.pdf', markdown: '# Old', confidence: 75 })
  assert.equal(job.extractionReview, undefined)
  assert.equal(job.sourcePdf, undefined)
  assert.equal(job.markdown, '# Old')
})
