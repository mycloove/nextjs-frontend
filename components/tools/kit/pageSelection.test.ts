import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeSelection,
  invertSelection,
  moveFocus,
  rangeToSelection,
  selectAllPages,
  selectSpan,
  selectionToRange,
  togglePage,
} from './pageSelection.ts'

const set = (...pages: number[]) => new Set(pages)

test('selection is written back as the shortest range text', () => {
  assert.equal(selectionToRange(set()), '')
  assert.equal(selectionToRange(set(4)), '4')
  assert.equal(selectionToRange(set(10, 1, 2, 3, 5, 8, 9)), '1-3, 5, 8-10')
})

test('range text and selection round-trip', () => {
  const parsed = rangeToSelection('1-3, 5, 8-', 10)
  assert.equal(parsed.ok, true)
  if (parsed.ok) assert.equal(selectionToRange(parsed.pages), '1-3, 5, 8-10')
  const empty = rangeToSelection('   ', 10)
  assert.ok(empty.ok && empty.pages.size === 0)
})

test('bad range text is reported, never silently trimmed', () => {
  const letters = rangeToSelection('1-a', 10)
  assert.equal(letters.ok, false)
  const beyond = rangeToSelection('2, 14-16', 12)
  assert.deepEqual(beyond, { ok: false, message: 'Page 14 does not exist — this PDF has 12 pages.' })
  const backwards = rangeToSelection('5-2', 12)
  assert.equal(backwards.ok, false)
})

test('toggle, span, all and invert', () => {
  assert.deepEqual([...togglePage(set(1, 2), 2)], [1])
  assert.deepEqual([...togglePage(set(1), 3)].sort(), [1, 3])
  assert.deepEqual([...selectSpan(set(9), 5, 2, false)].sort(), [2, 3, 4, 5])
  assert.deepEqual([...selectSpan(set(9), 5, 7, true)].sort((a, b) => a - b), [5, 6, 7, 9])
  assert.equal(selectAllPages(4).size, 4)
  assert.deepEqual([...invertSelection(set(1, 3), 4)], [2, 4])
})

test('focus moves within the grid and stops at its edges', () => {
  assert.equal(moveFocus(5, 'ArrowRight', 4, 10), 6)
  assert.equal(moveFocus(5, 'ArrowDown', 4, 10), 9)
  assert.equal(moveFocus(9, 'ArrowDown', 4, 10), 10)
  assert.equal(moveFocus(2, 'ArrowUp', 4, 10), 1)
  assert.equal(moveFocus(1, 'ArrowLeft', 4, 10), 1)
  assert.equal(moveFocus(4, 'End', 4, 10), 10)
  assert.equal(moveFocus(4, 'Home', 4, 10), 1)
  assert.equal(moveFocus(4, 'Enter', 4, 10), null)
})

test('selection summary reads naturally', () => {
  assert.equal(describeSelection(set(), 12), 'No pages selected of 12')
  assert.equal(describeSelection(set(1, 2, 3), 12), '3 of 12 pages selected')
  assert.equal(describeSelection(set(1), 1), 'All 1 page selected')
})
