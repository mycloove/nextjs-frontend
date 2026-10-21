import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeSectionDocuments } from './section-merge.ts'
import { DEFAULT_MERGE_OPTIONS, type MergeDoc, type MergeOptions } from './types.ts'

const doc = (id: string, title: string, markdown: string): MergeDoc => ({ id, title, markdown })

const opts = (patch: Partial<MergeOptions> = {}): MergeOptions => ({
  ...DEFAULT_MERGE_OPTIONS,
  mode: 'section',
  frontmatter: 'strip',
  ...patch,
})

test('duplicate headings are renamed with a rising suffix', () => {
  const docs = [doc('1', 'A', '# One\n\na'), doc('2', 'B', '# One\n\nb')]
  const { markdown, changes } = mergeSectionDocuments(docs, opts({ duplicateHeading: 'rename' }))
  assert.ok(markdown.includes('# One\n\na'))
  assert.ok(markdown.includes('# One (2)\n\nb'))
  assert.ok(changes.some((c) => c.key === 'renamed' && c.count === 1))
})

test('duplicate sections can be merged into one heading', () => {
  const docs = [doc('1', 'A', '# One\n\nalpha'), doc('2', 'B', '# One\n\nbeta')]
  const { markdown } = mergeSectionDocuments(docs, opts({ duplicateHeading: 'merge' }))
  assert.equal((markdown.match(/^# One$/gm) || []).length, 1)
  assert.ok(markdown.includes('alpha\n\nbeta'))
})

test('demote nests every source under a book H1', () => {
  const docs = [doc('1', 'A', '# One\n\na')]
  const { markdown } = mergeSectionDocuments(
    docs,
    opts({ headingLevel: 'demote', documentTitle: 'Book', duplicateHeading: 'keep' }),
  )
  assert.match(markdown, /^# Book\n\n## One/)
})

test('promote lifts the shallowest heading to H1', () => {
  const docs = [doc('1', 'A', '### Deep\n\nx')]
  const { markdown } = mergeSectionDocuments(docs, opts({ headingLevel: 'promote' }))
  assert.ok(markdown.includes('# Deep'))
})

test('colliding footnote ids are renumbered across sources', () => {
  const docs = [
    doc('1', 'A', 'note[^1]\n\n[^1]: first'),
    doc('2', 'B', 'note[^1]\n\n[^1]: second'),
  ]
  const { markdown, changes } = mergeSectionDocuments(docs, opts({ renumberFootnotes: true }))
  assert.ok(markdown.includes('[^1]'))
  assert.ok(markdown.includes('[^2]'))
  assert.ok(changes.some((c) => c.key === 'footnotes' && c.count >= 1))
})

test('new-title frontmatter names the result and keeps other keys', () => {
  const docs = [doc('1', 'A', '---\nauthor: me\n---\n# One\n\na')]
  const { markdown } = mergeSectionDocuments(
    docs,
    opts({ frontmatter: 'new-title', documentTitle: 'Bound' }),
  )
  assert.ok(markdown.startsWith('---\ntitle: Bound\nauthor: me\n---'))
})

test('a heading-less source still collates without losing content', () => {
  const docs = [doc('1', 'Loose', 'just prose here')]
  const { markdown } = mergeSectionDocuments(docs, opts({ duplicateHeading: 'keep' }))
  assert.ok(markdown.includes('# Loose'))
  assert.ok(markdown.includes('just prose here'))
})

test('setext headings are normalised and reported', () => {
  const docs = [doc('1', 'A', 'Title\n=====\n\nbody')]
  const { markdown, changes } = mergeSectionDocuments(docs, opts({ duplicateHeading: 'keep' }))
  assert.ok(markdown.includes('# Title'))
  assert.ok(changes.some((c) => c.key === 'setext' && c.count === 1))
})
