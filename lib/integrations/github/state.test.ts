import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPendingState,
  PENDING_STATE_TTL_MS,
  verifyPendingState,
} from './state.ts'

const SECRET = 'test-secret'
const NOW = 1_700_000_000_000

test('a freshly minted nonce verifies', () => {
  const value = createPendingState(SECRET, NOW)
  assert.equal(verifyPendingState(SECRET, value, NOW), true)
})

test('two nonces differ (each mint is one-time)', () => {
  assert.notEqual(createPendingState(SECRET, NOW), createPendingState(SECRET, NOW))
})

test('a nonce signed with another secret is refused', () => {
  const value = createPendingState('other-secret', NOW)
  assert.equal(verifyPendingState(SECRET, value, NOW), false)
})

test('an expired nonce is refused', () => {
  const value = createPendingState(SECRET, NOW)
  assert.equal(verifyPendingState(SECRET, value, NOW + PENDING_STATE_TTL_MS + 1), false)
})

test('a tampered signature or payload is refused', () => {
  const value = createPendingState(SECRET, NOW)
  const [nonce, expiry, signature] = value.split('.')
  assert.equal(verifyPendingState(SECRET, `${nonce}.${expiry}.${signature}x`, NOW), false)
  assert.equal(verifyPendingState(SECRET, `other.${expiry}.${signature}`, NOW), false)
})

test('malformed or empty input never throws', () => {
  assert.equal(verifyPendingState(SECRET, undefined, NOW), false)
  assert.equal(verifyPendingState(SECRET, '', NOW), false)
  assert.equal(verifyPendingState(SECRET, 'a.b', NOW), false)
  assert.equal(verifyPendingState(SECRET, 'a.b.c.d', NOW), false)
  assert.equal(verifyPendingState(SECRET, 'a.notanumber.c', NOW), false)
})
