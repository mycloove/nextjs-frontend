import assert from 'node:assert/strict'
import test from 'node:test'

import { DIFF_MAX_LINES, diffLines, isDiffTooLarge, summariseDiff } from './markdownLineDiff.ts'

test('identical text is entirely unchanged', () => {
  const rows = diffLines('# Title\n\nbody', '# Title\n\nbody')
  assert.ok(rows.length === 3)
  assert.ok(rows.every((row) => row.kind === 'same'))
  assert.deepEqual(summariseDiff('a\nb', 'a\nb'), { added: 0, removed: 0, changed: false })
})

test('an added line is reported as a single addition at the right place', () => {
  const rows = diffLines('a\nc', 'a\nb\nc')
  assert.deepEqual(rows.map((row) => row.kind), ['same', 'add', 'same'])
  assert.equal(rows[1].text, 'b')
  assert.equal(rows[1].bLine, 2)
  assert.deepEqual(summariseDiff('a\nc', 'a\nb\nc'), { added: 1, removed: 0, changed: true })
})

test('a removed line is reported as a single removal', () => {
  const rows = diffLines('a\nb\nc', 'a\nc')
  assert.deepEqual(rows.map((row) => row.kind), ['same', 'remove', 'same'])
  assert.equal(rows[1].text, 'b')
  assert.equal(rows[1].aLine, 2)
  assert.deepEqual(summariseDiff('a\nb\nc', 'a\nc'), { added: 0, removed: 1, changed: true })
})

test('a mid-file edit shows one removal and one addition', () => {
  const summary = summariseDiff('# Doc\nold line\nend', '# Doc\nnew line\nend')
  assert.deepEqual(summary, { added: 1, removed: 1, changed: true })
})

test('a trailing newline is a real change, not silently collapsed', () => {
  const summary = summariseDiff('a', 'a\n')
  assert.deepEqual(summary, { added: 1, removed: 0, changed: true })
})

test('CRLF and LF that carry the same text are treated as unchanged', () => {
  const summary = summariseDiff('a\r\nb\r\n', 'a\nb\n')
  assert.deepEqual(summary, { added: 0, removed: 0, changed: false })
})

test('a whole-file replacement keeps the shared prefix and suffix', () => {
  const before = 'head\n1\n2\n3\ntail'
  const after = 'head\nx\ny\ntail'
  const rows = diffLines(before, after)
  assert.equal(rows[0].kind, 'same')
  assert.equal(rows[rows.length - 1].kind, 'same')
  assert.deepEqual(summariseDiff(before, after), { added: 2, removed: 3, changed: true })
})

test('very large input is flagged and diffed coarsely without stalling', () => {
  const big = Array.from({ length: DIFF_MAX_LINES + 10 }, (_, i) => `line ${i}`).join('\n')
  const twoBig = `${big}\nextra`
  assert.equal(isDiffTooLarge(big, twoBig), true)

  const rows = diffLines(big, twoBig)
  // the shared prefix stays identical and only the appended line is added
  assert.equal(rows[0].kind, 'same')
  const summary = summariseDiff(big, twoBig)
  assert.equal(summary.changed, true)
  assert.equal(summary.added, 1)
  assert.equal(summary.removed, 0)
})

test('empty-to-content and content-to-empty are honest about the whole file', () => {
  assert.deepEqual(summariseDiff('', 'a\nb'), { added: 2, removed: 1, changed: true })
  assert.deepEqual(summariseDiff('a\nb', ''), { added: 1, removed: 2, changed: true })
})
