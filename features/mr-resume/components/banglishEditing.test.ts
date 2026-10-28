import assert from 'node:assert/strict'
import test from 'node:test'
import { isSingleTypingInsertion, rebaseBanglishSources, rememberBanglishSource, replaceBanglishSource, restoreBanglishAtCaret, validBanglishSources, type BanglishSource } from './banglishEditing.ts'

const source: BanglishSource = { source: 'ami', reading: '\u0986\u09ae\u09bf', start: 0, end: 3 }
const text = `${source.reading} Excel`

test('a conversion preserves the delimiter, suffix and actual output range', () => {
  const result = replaceBanglishSource(text, source, '\u0986\u09ae\u09be\u09b0')!
  assert.equal(result.next, '\u0986\u09ae\u09be\u09b0 Excel')
  assert.equal(result.caret, 4)
  assert.equal(result.source.end, 4)
  assert.deepEqual(restoreBanglishAtCaret(result.next, 4, [result.source])?.next, 'ami Excel')
})

test('Backspace restoration is independent of native undo and preserves surrounding content', () => {
  for (const caret of [1, 2, 3, 4]) {
    const restored = restoreBanglishAtCaret(text, caret, [source])!
    assert.equal(restored.next, 'ami Excel')
    assert.equal(restored.caret, 3)
  }
  assert.equal(restoreBanglishAtCaret(text, 0, [source]), null)
  assert.equal(restoreBanglishAtCaret(text, 5, [source]), null)
  assert.equal(restoreBanglishAtCaret(`${source.reading}\nExcel`, 4, [source]), null)
})

test('edits before a converted word rebase both endpoints', () => {
  const previous = `Hi ${text}`
  const span = { ...source, start: 3, end: 6 }
  assert.deepEqual(rebaseBanglishSources(previous, `Hello ${text}`, [span]), [{ ...source, start: 6, end: 9 }])
  assert.deepEqual(rebaseBanglishSources(previous, text, [span]), [source])
})

test('overlapping edits and stale text invalidate ranges instead of overwriting unrelated text', () => {
  assert.deepEqual(rebaseBanglishSources(text, '\u0986\u09ae\u09be\u09b0 Excel', [source]), [])
  assert.deepEqual(validBanglishSources('abc Excel', [source]), [])
  assert.equal(replaceBanglishSource('abc Excel', source, '\u09a4\u09c1\u09ae\u09bf'), null)
  assert.deepEqual(rebaseBanglishSources(text, `${source.reading}x Excel`, [source]), [])
  assert.deepEqual(rebaseBanglishSources(text, `x${text}`, [source]), [])
  assert.deepEqual(validBanglishSources(text, [{ ...source, end: 100 }, { ...source, start: -1 }]), [])
})

test('formatting delimiters can surround a word without losing its valid source', () => {
  const next = `**${text}`
  assert.deepEqual(rebaseBanglishSources(text, next, [source]), [{ ...source, start: 2, end: 5 }])
  assert.deepEqual(rebaseBanglishSources(text, `${source.reading}, Excel`, [source]), [source])
})

test('remembering a revised reading replaces only its old range', () => {
  const nextSource = { ...source, reading: '\u0986\u09ae\u09be\u09b0', end: 4 }
  assert.deepEqual(rememberBanglishSource('\u0986\u09ae\u09be\u09b0 Excel', [source], nextSource), [nextSource])
  assert.deepEqual(rememberBanglishSource(text, [source], { ...source, reading: 'different' }), [])
})

test('typing detection rejects paste, replacement, deletion, and stale carets', () => {
  assert.equal(isSingleTypingInsertion('ami', 'ami ', 4), true)
  assert.equal(isSingleTypingInsertion('left ami right', 'left ami, right', 9), true)
  assert.equal(isSingleTypingInsertion('ami', 'ami\n', 4), true)
  assert.equal(isSingleTypingInsertion('', 'ami ', 4), false)
  assert.equal(isSingleTypingInsertion('ami', 'am ', 3), false)
  assert.equal(isSingleTypingInsertion('ami', 'am', 2), false)
  assert.equal(isSingleTypingInsertion('ami', 'ami ', 99), false)
})

test('Bengali combining marks and ZWJ do not become detached correction targets', () => {
  assert.deepEqual(validBanglishSources(`${source.reading}\u09be`, [source]), [])
  assert.deepEqual(validBanglishSources(`${source.reading}\u200d`, [source]), [])
  const conjunct = { source: 'shikkha', reading: '\u09b6\u09bf\u0995\u09cd\u09b7\u09be', start: 0, end: 6 }
  assert.equal(restoreBanglishAtCaret(`${conjunct.reading} rest`, 3, [conjunct])?.next, 'shikkha rest')
})

test('candidate replacement preserves a caret after its already-typed separator', () => {
  const result = replaceBanglishSource(text, source, '\u0986\u09ae\u09be\u09b0', 4)!
  assert.equal(result.next, '\u0986\u09ae\u09be\u09b0 Excel')
  assert.equal(result.caret, 5)
  assert.equal(result.next.slice(0, result.caret), '\u0986\u09ae\u09be\u09b0 ')
  assert.equal(replaceBanglishSource(text, source, source.reading, 4)?.caret, 4)
  assert.equal(replaceBanglishSource(text, source, 'ami', 4)?.caret, 4)
  assert.equal(replaceBanglishSource(text, source, 'ami', -1), null)
  assert.equal(replaceBanglishSource(text, source, 'ami', 100), null)
})

test('live and committed candidate replacements share exact word-boundary validation', () => {
  const live = { source: 'dhaka', reading: 'dhaka', start: 0, end: 5 }
  const result = replaceBanglishSource('dhaka suffix', live, '\u09a2\u09be\u0995\u09be', 5)!
  assert.equal(result.next, '\u09a2\u09be\u0995\u09be suffix')
  assert.equal(result.caret, 4)
  assert.equal(replaceBanglishSource('dhakasuffix', live, '\u09a2\u09be\u0995\u09be', 5), null)
  assert.equal(replaceBanglishSource('different suffix', live, '\u09a2\u09be\u0995\u09be', 5), null)
})

test('Space accepts a live or committed reading without duplicating its separator', () => {
  const reading = '\u0986\u09ae\u09be\u09b0'
  for (const caret of [3, 4]) {
    const result = replaceBanglishSource(text, source, reading, caret, ' ')!
    assert.equal(result.next, `${reading} Excel`)
    assert.equal(result.caret, reading.length + 1)
  }
  const live = replaceBanglishSource('ami', { source: 'ami', reading: 'ami', start: 0, end: 3 }, reading, 3, ' ')!
  assert.equal(live.next, `${reading} `)
  assert.equal(live.caret, reading.length + 1)
  const punctuation = replaceBanglishSource(`${source.reading}, suffix`, source, reading, 5, ' ')!
  assert.equal(punctuation.next, `${reading}, suffix`)
  assert.equal(punctuation.caret, reading.length + 2)
})
