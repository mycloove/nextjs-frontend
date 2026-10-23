import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateCreditBalance, canSpendCredits, creditInteger, creditReason, validateCreditPolicy } from './credit-policy.ts'

test('the last credit is spendable and a free action does not require a balance', () => {
  assert.equal(canSpendCredits(1, 1), true)
  assert.equal(canSpendCredits(0, 1), false)
  assert.equal(canSpendCredits(0, 0), true)
})

test('rolling credits return only as real settled spend expires', () => {
  const now = new Date('2026-10-22T16:00:00Z')
  const expiry = new Date('2026-10-22T17:00:00Z')
  const balance = calculateCreditBalance({ allowance: 20, reserved: 3, now, entries: [
    { amount: -5, expiresAt: expiry },
    { amount: -2, expiresAt: expiry },
    { amount: -9, expiresAt: now },
    { amount: 4, expiresAt: new Date('2026-10-23T16:00:00Z') },
  ] })
  assert.deepEqual(balance, { available: 14, used: 7, reserved: 3, next_return_at: expiry.toISOString(), next_return_amount: 7 })
})

test('lowering an allowance never displays negative available or invents a return time', () => {
  const result = calculateCreditBalance({ allowance: 2, reserved: 4, entries: [], now: new Date() })
  assert.equal(result.available, 0)
  assert.equal(result.next_return_at, null)
})

test('admin numbers reject coercion, fractions, NaN and excessive amounts', () => {
  for (const value of ['', '20', null, false, -1, 1.2, NaN, Infinity, 1_000_001]) {
    assert.throws(() => creditInteger(value, 'Allowance'))
  }
  assert.equal(creditInteger(0, 'Allowance'), 0)
  assert.throws(() => creditReason('\n\u0000bad'))
  assert.equal(creditReason('  Support adjustment  '), 'Support adjustment')
})

test('policy rejects incomplete bodies, disabled coercion and unsupported windows', () => {
  const valid = { enabled: true, guest_allowance: 20, member_allowance: 100, period_hours: 24, expected_version: 1 }
  assert.equal(validateCreditPolicy(valid).memberAllowance, 100)
  for (const bad of [null, [], { ...valid, enabled: 'true' }, { ...valid, period_hours: 12 }, { ...valid, expected_version: 0 }]) {
    assert.throws(() => validateCreditPolicy(bad))
  }
})
