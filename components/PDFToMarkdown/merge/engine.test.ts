import assert from 'node:assert/strict'
import test from 'node:test'

import { describeSources, mergeDocuments } from './engine.ts'
import { DEFAULT_MERGE_OPTIONS, type MergeDoc, type MergeOptions } from './types.ts'

const doc = (id: string, title: string, markdown: string): MergeDoc => ({ id, title, markdown })

const opts = (patch: Partial<MergeOptions> = {}): MergeOptions => ({
  ...DEFAULT_MERGE_OPTIONS,
  frontmatter: 'strip',
  ...patch,
})

const DOCS = [
  doc('1', 'Alpha', '# Alpha\n\nfirst body'),
  doc('2', 'Beta', '# Beta\n\nsecond body'),
]

test('concat mode returns a report describing each source', () => {
  const res = mergeDocuments(DOCS, opts({ mode: 'concat' }))
  assert.equal(res.report.sources.length, 2)
  assert.equal(res.report.sources[0].sections, 1)
  assert.ok(res.report.words > 0)
  assert.ok(res.markdown.includes('first body') && res.markdown.includes('second body'))
})

test('section mode returns a non-empty markdown and change list', () => {
  const res = mergeDocuments(DOCS, opts({ mode: 'section' }))
  assert.ok(res.markdown.length > 0)
  assert.ok(res.report.changes.length > 0)
})

test('describeSources counts sections and detects Bijoy per source', () => {
  const stats = describeSources([
    doc('1', 'A', '# One\n\n## Two\n\nbody'),
    doc('2', 'B', 'Avgvi evsjv fvlv'),
  ])
  assert.equal(stats[0].sections, 2)
  assert.equal(stats[1].bijoy, true)
})

test('an empty source list yields an empty result and a warning', () => {
  const res = mergeDocuments([], opts({ mode: 'section' }))
  assert.equal(res.markdown, '')
  assert.equal(res.report.warnings.length, 1)
})
