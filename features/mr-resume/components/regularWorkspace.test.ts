import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareRegularSuspension, type RegularSuspensionState } from './regularWorkspace.ts'

const ready: RegularSuspensionState = { restored: true, printing: false, gesture: false, modal: false, writable: true }

test('leaving Regular flushes the latest eligible draft synchronously', () => {
  let writing = 'older writing'
  const writes: string[] = []
  writing = 'typed less than 700ms ago'
  const result = prepareRegularSuspension(ready, () => { writes.push(writing); return '2026-10-29T00:00:00.000Z' })
  assert.equal(result.reason, null)
  assert.deepEqual(writes, [writing])
  assert.equal(result.savedAt, '2026-10-29T00:00:00.000Z')
})

test('a blocked or unavailable Regular store is never overwritten on mode changes', () => {
  let writes = 0
  assert.equal(prepareRegularSuspension({ ...ready, writable: false }, () => { writes++; return '' }).reason, null)
  assert.equal(writes, 0)
})

test('restore, printing, active gestures and modal ownership block hiding without saving', () => {
  for (const state of [{ ...ready, restored: false }, { ...ready, printing: true }, { ...ready, gesture: true }, { ...ready, modal: true }]) {
    let called = false
    assert.ok(prepareRegularSuspension(state, () => { called = true; return '' }).reason)
    assert.equal(called, false)
  }
})

test('failed flush keeps mode switching and in-memory editing possible with honest save feedback', () => {
  const result = prepareRegularSuspension(ready, () => { throw new Error('storage full') })
  assert.equal(result.reason, null)
  assert.equal(result.saveFailed, true)
  assert.equal(result.savedAt, undefined)
})
