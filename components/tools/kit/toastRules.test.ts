import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_TOASTS, dismissToast, enqueueToast, toastDuration, type Toast } from './toastRules.ts'

const toast = (id: number, tone: Toast['tone'], message = `m${id}`): Toast => ({ id, tone, message })

test('errors stay until dismissed; others time out', () => {
  assert.equal(toastDuration('error'), null)
  assert.equal(toastDuration('success'), 4000)
})

test('a full queue drops the oldest non-error first', () => {
  let queue: Toast[] = []
  queue = enqueueToast(queue, toast(1, 'error'))
  queue = enqueueToast(queue, toast(2, 'success'))
  queue = enqueueToast(queue, toast(3, 'info'))
  queue = enqueueToast(queue, toast(4, 'success'))
  assert.equal(queue.length, MAX_TOASTS)
  assert.deepEqual(queue.map((t) => t.id), [1, 3, 4])
  assert.deepEqual(dismissToast(queue, 3).map((t) => t.id), [1, 4])
})

test('identical toasts do not stack', () => {
  const queue = enqueueToast([toast(1, 'success', 'Copied')], toast(2, 'success', 'Copied'))
  assert.deepEqual(queue.map((t) => t.id), [1])
})
