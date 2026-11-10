import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  acceptsLabel,
  describeLimits,
  fileKindLabel,
  formatBytes,
  formatElapsed,
  progressStage,
  summarizeDrag,
  validateIntake,
  type IntakeSpec,
} from './intakeRules.ts'

const MB = 1024 * 1024
const PDF = { mime: 'application/pdf', extensions: ['.pdf'], label: 'PDF' }
const ZIP = { mime: 'application/zip', extensions: ['.zip'], label: 'ZIP' }
const single: IntakeSpec = { accepts: [PDF], limits: { maxFileBytes: 50 * MB, maxFiles: 1, maxTotalBytes: 150 * MB } }
const multi: IntakeSpec = { accepts: [PDF], limits: { maxFileBytes: 50 * MB, minFiles: 2, maxFiles: 3, maxTotalBytes: 100 * MB } }
const pdf = (name: string, size = MB, type = 'application/pdf') => ({ name, size, type })

test('formatBytes uses whole MB from 10 MB up and never shows 0 KB', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1), '1 B')
  assert.equal(formatBytes(1100), '1 KB')
  assert.equal(formatBytes(2.5 * MB), '2.5 MB')
  assert.equal(formatBytes(84 * MB), '84 MB')
})

test('limits line is written from the registry entry', () => {
  assert.equal(describeLimits(single), 'PDF · one file · up to 50 MB')
  assert.equal(describeLimits(multi), 'PDF · 2–3 files · up to 50 MB each')
  assert.equal(acceptsLabel([PDF, ZIP]), 'PDF or ZIP')
})

test('wrong type names the actual kind, not just "invalid"', () => {
  const result = validateIntake([pdf('report.docx', MB, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')], single)
  assert.equal(result.accepted.length, 0)
  assert.equal(result.rejections[0].reason, 'type')
  assert.equal(result.rejections[0].message, 'report.docx is a DOCX; this tool takes PDF.')
  assert.equal(fileKindLabel(pdf('scan.svg', 1, '')), 'SVG')
  assert.match(validateIntake([pdf('scan.svg', 1, '')], single).rejections[0].message, /is an SVG/)
})

test('extension alone is enough when the browser reports no MIME', () => {
  const result = validateIntake([pdf('Report.PDF', MB, '')], single)
  assert.equal(result.accepted.length, 1)
})

test('oversized file states its size and the limit', () => {
  const result = validateIntake([pdf('big.pdf', 84 * MB)], single)
  assert.equal(result.rejections[0].reason, 'size')
  assert.equal(result.rejections[0].message, 'big.pdf is 84 MB; the limit is 50 MB per file.')
})

test('single-file tool keeps the first acceptable file and reports the rest', () => {
  const result = validateIntake([pdf('notes.txt', 10, 'text/plain'), pdf('a.pdf'), pdf('b.pdf')], single, { count: 1, bytes: MB })
  assert.deepEqual(result.accepted.map((f) => f.name), ['a.pdf'])
  assert.deepEqual(result.rejections.map((r) => r.reason), ['type', 'count'])
})

test('multi-file tool counts files and bytes it already holds', () => {
  const result = validateIntake([pdf('c.pdf'), pdf('d.pdf')], multi, { count: 2, bytes: 2 * MB })
  assert.deepEqual(result.accepted.map((f) => f.name), ['c.pdf'])
  assert.equal(result.rejections[0].reason, 'count')

  const heavy = validateIntake([pdf('e.pdf', 45 * MB), pdf('f.pdf', 45 * MB), pdf('g.pdf', 45 * MB)], multi)
  assert.deepEqual(heavy.accepted.map((f) => f.name), ['e.pdf', 'f.pdf'])
  assert.equal(heavy.rejections[0].reason, 'total')
})

test('drag summary refuses only what it can actually see', () => {
  assert.equal(summarizeDrag([{ kind: 'string', type: 'text/plain' }], single).count, 0)
  assert.deepEqual(summarizeDrag([{ kind: 'file', type: 'image/png' }], single), {
    count: 1, acceptable: false, label: 'This tool takes PDF only',
  })
  assert.equal(summarizeDrag([{ kind: 'file', type: '' }], single).acceptable, true)
  assert.equal(summarizeDrag([{ kind: 'file', type: 'application/pdf' }, { kind: 'file', type: 'application/pdf' }], single).label, 'Drop — the first PDF is used')
  assert.equal(summarizeDrag([{ kind: 'file', type: 'application/pdf' }, { kind: 'file', type: 'application/pdf' }], multi).label, 'Drop to add 2 files')
})

test('progress is a real percentage only while bytes are uploading', () => {
  assert.deepEqual(progressStage(0), { kind: 'uploading', percent: 0 })
  assert.deepEqual(progressStage(42.4), { kind: 'uploading', percent: 42 })
  assert.deepEqual(progressStage(100), { kind: 'processing' })
  assert.deepEqual(progressStage(null), { kind: 'processing' })
})

test('elapsed time reads as seconds, then minutes', () => {
  assert.equal(formatElapsed(-5), '0 s')
  assert.equal(formatElapsed(12_900), '12 s')
  assert.equal(formatElapsed(65_000), '1 min 05 s')
})
