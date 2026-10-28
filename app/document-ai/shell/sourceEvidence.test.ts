import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSourcePages, normalizeChatSources, sourceCitation, sourceGroupForCitation, sourcePageNumber } from './sourceEvidence.ts'
import type { ShellDocument, ShellMessage } from './types.ts'

const documents: ShellDocument[] = ['a', 'b'].map((docId) => ({ docId, name: `${docId}.pdf`, pdfUrl: '', sessionId: 'session', docNumber: 1, uploadedAt: 1, pages: 12 }))
const message = (sources: ShellMessage['sources'], extra: Partial<ShellMessage> = {}): ShellMessage => ({ id: 'answer', role: 'assistant', text: 'Response', createdAt: 1, sources, ...extra })

test('only positive integer page numbers are known', () => {
  for (const value of [null, undefined, 0, -2, 1.5, '7', NaN, Infinity]) assert.equal(sourcePageNumber(value), null)
  assert.equal(sourcePageNumber(7), 7)
})

test('normalization uses the reported resolved document, never an active-tab guess', () => {
  const result = normalizeChatSources({ resolved_doc_id: 'b', sources: [{ page: 3, preview: 'Actual excerpt' }, { page: 4, doc_id: 'a', text: 'Other source' }, { page: 0 }] })
  assert.deepEqual(result.sources.map((source) => source.doc_id), ['b', 'a', 'b'])
  assert.equal(result.sources[2].page, null)
  assert.equal(result.sources[2].label, 'Page unknown')
  assert.equal(result.resolvedDocId, 'b')
})

test('a pages array alone does not invent source passages', () => {
  assert.deepEqual(normalizeChatSources({ pages: [1, 2, 3] }).sources, [])
  assert.deepEqual(normalizeChatSources({ sources: [null, 2, 'bad'] }).sources, [])
})

test('same page numbers in different documents stay separate', () => {
  const msg = message([{ page: 3, label: 'p.3', doc_id: 'a', text: 'First' }, { page: 3, label: 'p.3', doc_id: 'b', text: 'Second' }])
  const groups = buildSourcePages([msg], documents)
  assert.equal(groups.length, 2)
  assert.notEqual(groups[0].id, groups[1].id)
  assert.match(groups[0].pageLabel, /a\.pdf/)
  assert.match(groups[1].pageLabel, /b\.pdf/)
  assert.equal(sourceGroupForCitation(groups, sourceCitation(msg, msg.sources![1], 1)), groups[1])
})

test('known document/page references group together with stable chat and panel IDs', () => {
  const msg = message([{ page: 4, label: 'p.4', text: 'One' }, { page: 4, label: 'p.4', text: 'Two' }], { resolvedDocId: 'a' })
  const groups = buildSourcePages([msg], documents)
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].citationIds, ['answer_0', 'answer_1'])
  assert.equal(sourceCitation(msg, msg.sources![1], 1).id, groups[0].citationIds[1])
})

test('legacy gaps and missing text never become fabricated clauses or page one', () => {
  const legacy = message([{ page: null, label: 'src', isGap: true }], { isGap: true })
  const [group] = buildSourcePages([legacy], documents)
  assert.equal(group.pageNum, null)
  assert.equal(group.docId, undefined)
  assert.match(group.pageLabel, /Document unknown.*Page unknown/)
  const output = JSON.stringify(group)
  assert.doesNotMatch(output, /No matching clause|Page 1|of 12/)
  assert.match(output, /No excerpt text was returned/)
  assert.equal(sourceCitation(legacy, legacy.sources![0], 0).isGap, false)
})

test('unknown document or page identities are not collapsed into one source', () => {
  const unknown = message([{ page: 2, label: 'p.2' }, { page: 2, label: 'p.2' }, { page: null, label: 'src', doc_id: 'a' }, { page: null, label: 'src', doc_id: 'a' }])
  assert.equal(buildSourcePages([unknown], documents).length, 4)
})

test('loading/error messages do not create evidence and unknown jumps do not select arbitrary sources', () => {
  const sources = [{ page: 2, label: 'p.2', doc_id: 'a', text: 'Excerpt' }]
  assert.deepEqual(buildSourcePages([message(sources, { loading: true }), message(sources, { error: 'Failed' })], documents), [])
  const groups = buildSourcePages([message(sources)], documents)
  assert.equal(sourceGroupForCitation(groups, { id: 'not-present', page: 2, label: 'p.2' }), undefined)
})
