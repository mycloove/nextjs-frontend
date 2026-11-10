import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  bundlesFromCuts,
  bundlesFromPicked,
  bundlesToSpec,
  cutsBySize,
  cutsEveryN,
  cutsFromBookmarks,
  formatSize,
  parseCustomRanges,
  partFileName,
} from './splitPlan.ts'

test('blades partition the whole document; stray cuts are ignored', () => {
  assert.deepEqual(bundlesFromCuts([3, 7], 10), [[1, 3], [4, 7], [8, 10]])
  assert.deepEqual(bundlesFromCuts([0, 10, 12, 3, 3], 10), [[1, 3], [4, 10]])
  assert.deepEqual(bundlesFromCuts([], 4), [[1, 4]])
  assert.deepEqual(bundlesFromCuts([1], 0), [])
})

test('picked pages become one part per contiguous run', () => {
  assert.deepEqual(bundlesFromPicked([5, 1, 2, 9, 3]), [[1, 3], [5, 5], [9, 9]])
  assert.deepEqual(bundlesFromPicked([]), [])
})

test('every N pages', () => {
  assert.deepEqual(cutsEveryN(3, 10), [3, 6, 9])
  assert.deepEqual(cutsEveryN(5, 10), [5])
  assert.deepEqual(cutsEveryN(10, 10), [])
  assert.deepEqual(cutsEveryN(0, 10), [])
  assert.deepEqual(cutsEveryN(2.7, 6), [2, 4])
})

test('size mode spreads the file evenly and never cuts after the last page', () => {
  assert.deepEqual(cutsBySize(10 * 1048576, 10, 3), [3, 6, 9])
  assert.deepEqual(cutsBySize(1048576, 10, 5), [])
  assert.deepEqual(cutsBySize(0, 10, 1), [])
})

test('a bookmark starts its section: the cut falls before the bookmarked page', () => {
  // Chapters on pages 4 and 8 → parts 1–3, 4–7, 8–10 (the old code made 1–4, 5–8, 9–10).
  const cuts = cutsFromBookmarks([8, 4], 10)
  assert.deepEqual(cuts, [3, 7])
  assert.deepEqual(bundlesFromCuts(cuts, 10), [[1, 3], [4, 7], [8, 10]])
  // A bookmark on page 1 is not a cut.
  assert.deepEqual(cutsFromBookmarks([1, 5], 10), [4])
})

test('typed ranges keep the typed order and report pages that do not exist', () => {
  assert.deepEqual(parseCustomRanges('8-, 1-3, 5', 10), { ok: true, bundles: [[8, 10], [1, 3], [5, 5]] })
  assert.deepEqual(parseCustomRanges('  ', 10), { ok: true, bundles: [] })
  assert.deepEqual(parseCustomRanges('2, 14-16', 12), { ok: false, message: 'Page 14 does not exist — this PDF has 12 pages.' })
  assert.equal(parseCustomRanges('1-a', 10).ok, false)
  assert.equal(parseCustomRanges('5-2', 10).ok, false)
})

test('the spec round-trips the server grammar', () => {
  assert.equal(bundlesToSpec([[1, 3], [5, 5], [8, 10]]), '1-3, 5, 8-10')
})

test('tray names are exactly the download names', () => {
  const bundles: [number, number][] = [[1, 3], [4, 6]]
  assert.equal(partFileName('Report.pdf', bundles, 1, false), 'mycloove_Report_part2_pages_4-6.pdf')
  assert.equal(partFileName('Report.pdf', [[2, 5]], 0, false), 'mycloove_Report_pages_2-5.pdf')
  assert.equal(partFileName('Report.pdf', bundles, 0, true), 'mycloove_Report_selected_pages.pdf')
})

test('estimated sizes never show fractional bytes', () => {
  assert.equal(formatSize(967.1999999999999), '967 B')
  assert.equal(formatSize(1500), '1 KB')
  assert.equal(formatSize(2.5 * 1048576), '2.5 MB')
})
