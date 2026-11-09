import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { TrayItem } from './types.ts'
import {
  groupBySource,
  insertInNaturalOrder,
  isGroupedBySource,
  moveTrayItem,
  orderBlocksBySource,
  setSourcePages,
  sortFilesByName,
  toggleSourcePage,
} from './trayOrder.ts'

/**
 * The output-order rules, pinned. Run with `npm run test:pdf-tools`.
 * A = source 1, B = source 2; labels read "<letter><page>".
 */

const letter: Record<number, string> = { 1: 'A', 2: 'B', 3: 'C' }
const ids = (sourceId: number, pageNumber: number) => `${letter[sourceId]}${pageNumber}`
const item = (sourceId: number, pageNumber: number): TrayItem => ({
  id: ids(sourceId, pageNumber),
  sourceId,
  pageNumber,
})
const labels = (tray: TrayItem[]) => tray.map((t) => `${letter[t.sourceId]}${t.pageNumber}`)
const AB = [1, 2]
const base = [item(1, 1), item(1, 2), item(2, 1), item(2, 2)]

test('Select all on the first document keeps it first (the reported order bug)', () => {
  // A had page 2 deselected; re-selecting all used to move A behind B.
  const tray = [item(1, 1), item(2, 1), item(2, 2)]
  assert.deepEqual(labels(setSourcePages(tray, AB, 1, [1, 2], ids)), ['A1', 'A2', 'B1', 'B2'])
})

test('clearing then re-selecting a document restores it in its rail position', () => {
  const cleared = setSourcePages(base, AB, 1, [], ids)
  assert.deepEqual(labels(cleared), ['B1', 'B2'])
  assert.deepEqual(labels(setSourcePages(cleared, AB, 1, [1, 2], ids)), ['A1', 'A2', 'B1', 'B2'])
})

test('re-ticking a single page returns it to its place, not the end', () => {
  const without = toggleSourcePage(base, AB, 1, 1, ids)
  assert.deepEqual(labels(without), ['A2', 'B1', 'B2'])
  assert.deepEqual(labels(toggleSourcePage(without, AB, 1, 1, ids)), ['A1', 'A2', 'B1', 'B2'])
})

test('a manual arrangement survives a selection change on the same document', () => {
  const arranged = [item(2, 1), item(1, 2), item(1, 1), item(2, 2)]
  // Removing B2 and adding nothing else must not reshuffle anything.
  assert.deepEqual(labels(setSourcePages(arranged, AB, 2, [1], ids)), ['B1', 'A2', 'A1'])
})

test('inserting pages of an absent middle document lands between its neighbours', () => {
  const tray = [item(1, 1), item(3, 1)]
  const next = insertInNaturalOrder(tray, [1, 2, 3], [item(2, 2), item(2, 1)])
  assert.deepEqual(labels(next), ['A1', 'B1', 'B2', 'C1'])
})

test('reordering documents moves whole blocks and keeps inner arrangement', () => {
  const tray = [item(1, 2), item(1, 1), item(2, 1)]
  assert.equal(isGroupedBySource(tray), true)
  assert.deepEqual(labels(orderBlocksBySource(tray, [2, 1])), ['B1', 'A2', 'A1'])
})

test('interleaved trays are detected so a rail reorder never silently undoes them', () => {
  assert.equal(isGroupedBySource([item(1, 1), item(2, 1), item(1, 2)]), false)
  assert.equal(isGroupedBySource([]), true)
})

test('group by source uses rail order then page order', () => {
  const tray = [item(1, 2), item(2, 1), item(1, 1)]
  assert.deepEqual(labels(groupBySource(tray, [2, 1])), ['B1', 'A1', 'A2'])
})

test('moveTrayItem is a true move-to-position and ignores out-of-range moves', () => {
  assert.deepEqual(labels(moveTrayItem(base, 3, 0)), ['B2', 'A1', 'A2', 'B1'])
  assert.deepEqual(labels(moveTrayItem(base, 0, 9)), ['A1', 'A2', 'B1', 'B2'])
})

test('files picked together are ordered by natural name, not OS order', () => {
  const picked = [{ name: '2.pdf' }, { name: '10.pdf' }, { name: '1.pdf' }]
  assert.deepEqual(
    sortFilesByName(picked).map((f) => f.name),
    ['1.pdf', '2.pdf', '10.pdf'],
  )
})
