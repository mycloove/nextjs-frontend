import assert from 'node:assert/strict'
import test from 'node:test'

import { concatDocuments } from './concat.ts'
import { DEFAULT_MERGE_OPTIONS, type MergeDoc, type MergeOptions } from './types.ts'

const doc = (id: string, title: string, markdown: string): MergeDoc => ({ id, title, markdown })

const opts = (patch: Partial<MergeOptions> = {}): MergeOptions => ({
  ...DEFAULT_MERGE_OPTIONS,
  frontmatter: 'strip',
  ...patch,
})

test('concatenation preserves every source body verbatim', () => {
  const docs = [doc('1', 'A', '# A\n\nAlpha line'), doc('2', 'B', '# B\n\nBeta line')]
  const { markdown } = concatDocuments(docs, opts({ separator: { style: 'blank', custom: '---' } }))
  assert.ok(markdown.includes('# A\n\nAlpha line'))
  assert.ok(markdown.includes('# B\n\nBeta line'))
  assert.ok(markdown.endsWith('\n'))
})

test('the rule separator drops a thematic break at the seam', () => {
  const docs = [doc('1', 'A', 'alpha'), doc('2', 'B', 'beta')]
  const { markdown } = concatDocuments(docs, opts({ separator: { style: 'rule', custom: '---' } }))
  assert.ok(markdown.includes('alpha\n\n---\n\nbeta'))
})

test('the heading separator labels the following source', () => {
  const docs = [doc('1', 'A', 'alpha'), doc('2', 'Chapter two', 'beta')]
  const { markdown } = concatDocuments(docs, opts({ separator: { style: 'heading', custom: '' } }))
  assert.ok(markdown.includes('alpha\n\n## Chapter two\n\nbeta'))
})

test('the custom separator uses its exact bytes', () => {
  const docs = [doc('1', 'A', 'alpha'), doc('2', 'B', 'beta')]
  const { markdown } = concatDocuments(docs, opts({ separator: { style: 'custom', custom: '<<< >>>' } }))
  assert.ok(markdown.includes('alpha\n\n<<< >>>\n\nbeta'))
})

test('keep-first frontmatter survives; later blocks are dropped and reported', () => {
  const docs = [
    doc('1', 'A', '---\ntitle: A\n---\n\n# A\n\nalpha'),
    doc('2', 'B', '---\ntitle: B\n---\n\n# B\n\nbeta'),
  ]
  const { markdown, changes } = concatDocuments(docs, opts({ frontmatter: 'keep-first' }))
  assert.ok(markdown.startsWith('---\ntitle: A\n---'))
  assert.ok(!markdown.includes('title: B'))
  assert.ok(changes.some((c) => c.key === 'frontmatter' && c.count === 1))
})

test('an unclosed code fence raises a warning instead of failing silently', () => {
  const docs = [doc('1', 'A', 'text\n\n```\nunterminated'), doc('2', 'B', 'more')]
  const { warnings } = concatDocuments(docs, opts())
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /unclosed code fence/)
})

test('an empty selection returns an empty result with a warning', () => {
  const res = concatDocuments([], opts())
  assert.equal(res.markdown, '')
  assert.equal(res.warnings.length, 1)
})

test('collapseBlankLines trims runs of three or more newlines', () => {
  const docs = [doc('1', 'A', 'alpha\n\n\n\nbeta')]
  const { markdown } = concatDocuments(docs, opts({ collapseBlankLines: true }))
  assert.ok(!/\n{3,}/.test(markdown))
})
