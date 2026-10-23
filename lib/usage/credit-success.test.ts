import assert from 'node:assert/strict'
import { test } from 'node:test'
import { documentCreditSucceeded } from './credit-success.ts'

test('Document AI no-document/reindex notices are not charged as answers', () => {
  assert.equal(documentCreditSucceeded({ answer: 'Please reupload the document', sources: [] }), false)
  assert.equal(documentCreditSucceeded({ answer: 'An answer', sources: [{ text: 'evidence' }] }), true)
  assert.equal(documentCreditSucceeded({ answer: '', sources: [{ text: 'evidence' }] }), false)
})
