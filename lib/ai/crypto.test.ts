import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AiConfigError, decryptWithKey, encryptWithKey, last4Of, maskKey, parseEnvSecret } from './crypto.ts'

const KEY = Buffer.alloc(32, 7)
const OTHER_KEY = Buffer.alloc(32, 9)

test('a value round-trips through the envelope', () => {
  const envelope = encryptWithKey(KEY, 'sk-test-abcdef123456')
  assert.match(envelope, /^v1:[^:]+:[^:]+:[^:]+$/)
  assert.equal(decryptWithKey(KEY, envelope), 'sk-test-abcdef123456')
})

test('two encryptions of the same value differ (random IV)', () => {
  assert.notEqual(encryptWithKey(KEY, 'same-key'), encryptWithKey(KEY, 'same-key'))
})

test('a tampered ciphertext fails the GCM check', () => {
  const parts = encryptWithKey(KEY, 'sk-tamper-me').split(':')
  const bytes = Buffer.from(parts[3], 'base64')
  bytes[0] = bytes[0] ^ 0xff
  parts[3] = bytes.toString('base64')
  assert.throws(() => decryptWithKey(KEY, parts.join(':')))
})

test('the wrong key cannot open an envelope', () => {
  const envelope = encryptWithKey(KEY, 'sk-secret')
  assert.throws(() => decryptWithKey(OTHER_KEY, envelope))
})

test('an empty secret is rejected as a 400', () => {
  assert.throws(
    () => encryptWithKey(KEY, '   '),
    (error: unknown) => error instanceof AiConfigError && error.status === 400,
  )
})

test('a short key is rejected', () => {
  assert.throws(() => encryptWithKey(Buffer.alloc(16, 1), 'x'), (error: unknown) => error instanceof AiConfigError)
})

test('parseEnvSecret accepts exactly 32 base64 bytes and rejects the rest', () => {
  const previous = process.env.AI_KEY_ENCRYPTION_SECRET
  try {
    delete process.env.AI_KEY_ENCRYPTION_SECRET
    assert.equal(parseEnvSecret(), null)
    process.env.AI_KEY_ENCRYPTION_SECRET = 'not-base64!!'
    assert.equal(parseEnvSecret(), null)
    process.env.AI_KEY_ENCRYPTION_SECRET = Buffer.alloc(16, 1).toString('base64')
    assert.equal(parseEnvSecret(), null)
    process.env.AI_KEY_ENCRYPTION_SECRET = KEY.toString('base64')
    assert.deepEqual(parseEnvSecret(), KEY)
  } finally {
    if (previous === undefined) delete process.env.AI_KEY_ENCRYPTION_SECRET
    else process.env.AI_KEY_ENCRYPTION_SECRET = previous
  }
})

test('masking shows a safe prefix and the last four characters', () => {
  assert.equal(last4Of('sk-abcdef1234'), '1234')
  assert.equal(maskKey('sk-or-v1-4ddabcdabcdabcdabcd8f'), 'sk-or-v1-4dd…cd8f')
  // A short key never reveals most of itself: no prefix, just the tail.
  assert.equal(maskKey('ab'), '…ab')
  assert.equal(maskKey(''), '…')
})
