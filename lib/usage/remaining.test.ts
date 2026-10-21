import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callsRemaining, usageWindow } from './catalog.ts'

test('raising a spent cap gives the difference back', () => {
  assert.equal(callsRemaining(5, 10), 5)
})

test('lowering the cap to calls already made leaves none', () => {
  assert.equal(callsRemaining(2, 2), 0)
})

test('unused calls stay available when the cap does not move', () => {
  assert.equal(callsRemaining(0, 5), 5)
})

test('a spent window resets one period after the oldest call', () => {
  const oldest = new Date('2026-09-30T00:00:00.000Z')
  const now = new Date('2026-09-30T06:00:00.000Z')
  const view = usageWindow(5, 10, oldest, 24, now)
  assert.equal(view.remaining, 5)
  assert.equal(view.allowed, true)
  assert.equal(view.resets_at, '2026-10-01T00:00:00.000Z')
})
