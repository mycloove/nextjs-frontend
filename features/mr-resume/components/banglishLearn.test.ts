import assert from 'node:assert/strict'
import test from 'node:test'
import { BANGLISH_LEARN_KEY, clearLearnedWords, forgetLearnedWord, isBengaliSpelling, isValidSpellingChoice, loadLearnedWords, loadSpellingChoices, saveLearnedWord } from './banglishLearn.ts'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  }
}

test('chosen spellings survive separate loads and normalized source casing', () => {
  const storage = memoryStorage()
  assert.equal(saveLearnedWord('Rahman', '\u09b0\u09b9\u09ae\u09be\u09a8', storage).saved, true)
  assert.deepEqual(loadLearnedWords(storage), { rahman: '\u09b0\u09b9\u09ae\u09be\u09a8' })
  saveLearnedWord('rahman', '\u09b0\u09b9\u09ae\u09be\u09a8', storage)
  assert.equal(loadSpellingChoices(storage)[0].count, 2)
  assert.equal(clearLearnedWords(storage), true)
  assert.deepEqual(loadLearnedWords(storage), {})
})

test('storage failures and server rendering do not throw or lose the selected session spelling', () => {
  const storage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('blocked') } }
  assert.deepEqual(loadLearnedWords(storage), {})
  assert.equal(saveLearnedWord('ami', '\u0986\u09ae\u09bf', storage).saved, false)
  assert.equal(saveLearnedWord('ami', '\u0986\u09ae\u09bf', storage).words.ami, '\u0986\u09ae\u09bf')
  assert.equal(clearLearnedWords(storage), false)
  assert.deepEqual(loadLearnedWords(), {})
})

test('malformed, oversized, and prototype-shaped data is ignored', () => {
  const storage = memoryStorage()
  for (const raw of ['{', 'null', '{}', JSON.stringify({ version: 2, words: [] }), 'x'.repeat(160001)]) {
    storage.setItem(BANGLISH_LEARN_KEY, raw)
    assert.deepEqual(loadLearnedWords(storage), {})
  }
  storage.setItem(BANGLISH_LEARN_KEY, JSON.stringify({ version: 1, words: [{ source: '__proto__', reading: '\u0986\u09ae\u09bf' }, { source: 'constructor', reading: '\u0986\u09ae\u09bf' }, { source: 'ami', reading: '\u0986\u09ae\u09bf', count: -7 }] }))
  assert.deepEqual(loadLearnedWords(storage), { ami: '\u0986\u09ae\u09bf' })
  assert.equal(loadSpellingChoices(storage)[0].count, 1)
})

test('only one Latin-source/Bengali-spelling pair is retained, never contacts or full resume text', () => {
  const storage = memoryStorage()
  for (const source of ['user@example.com', 'https://example.com', 'full name', 'Dhaka123', 'constructor', 'x'.repeat(41)]) {
    assert.equal(saveLearnedWord(source, '\u0986\u09ae\u09bf', storage).saved, false)
  }
  for (const reading of ['English', '<script>', '\u0986\u09ae\u09bf \u09a4\u09c1\u09ae\u09bf', '\u09e7\u09e8', '\u0986'.repeat(81)]) {
    assert.equal(saveLearnedWord('ami', reading, storage).saved, false)
  }
  assert.deepEqual(loadLearnedWords(storage), {})
})

test('a bounded word bank retains the newest 500 choices', () => {
  const storage = memoryStorage()
  for (let index = 0; index < 510; index++) {
    let suffix = ''
    let number = index + 1
    while (number) { suffix = String.fromCharCode(97 + number % 26) + suffix; number = Math.floor(number / 26) }
    saveLearnedWord(`word${suffix}`, '\u0986\u09ae\u09bf', storage)
  }
  assert.equal(Object.keys(loadLearnedWords(storage)).length, 500)
  assert.equal(loadLearnedWords(storage).wordb, undefined)
})

test('the editor and persistence use one spelling validation contract', () => {
  for (const value of ['\u0981', '\u09cd', '\u200d', '\u09e7', '\u0995\u09e7', 'hello']) assert.equal(isBengaliSpelling(value), false, value)
  assert.equal(isValidSpellingChoice('^', '\u0995'), false)
  assert.equal(isValidSpellingChoice('k,,t', '\u0995\u09cd\u09a4'), true)
  const storage = memoryStorage()
  assert.equal(saveLearnedWord('k,,t', '\u0995\u09cd\u09a4', storage).accepted, true)
  assert.equal(loadLearnedWords(storage)['k,,t'], '\u0995\u09cd\u09a4')
})

test('forgetting one word persists without discarding other learned names', () => {
  const storage = memoryStorage()
  saveLearnedWord('ami', '\u0986\u09ae\u09bf', storage)
  saveLearnedWord('rahman', '\u09b0\u09b9\u09ae\u09be\u09a8', storage)
  assert.equal(forgetLearnedWord('AMI', storage).saved, true)
  assert.deepEqual(loadLearnedWords(storage), { rahman: '\u09b0\u09b9\u09ae\u09be\u09a8' })
})

test('blocked storage retains multiple session choices and never resurrects forgotten words', () => {
  const storage = memoryStorage()
  saveLearnedWord('ami', '\u0986\u09ae\u09bf', storage)
  const blocked = { ...storage, setItem: () => { throw new Error('quota') } }
  const removed = forgetLearnedWord('ami', blocked)
  assert.equal(removed.saved, false)
  const first = saveLearnedWord('rahman', '\u09b0\u09b9\u09ae\u09be\u09a8', blocked, removed.choices)
  const second = saveLearnedWord('dhaka', '\u09a2\u09be\u0995\u09be', blocked, first.choices)
  assert.equal(second.words.ami, undefined)
  assert.equal(second.words.rahman, '\u09b0\u09b9\u09ae\u09be\u09a8')
  assert.equal(second.words.dhaka, '\u09a2\u09be\u0995\u09be')
  const again = saveLearnedWord('rahman', '\u09b0\u09b9\u09ae\u09be\u09a8', blocked, second.choices)
  assert.equal(again.choices.find((choice) => choice.source === 'rahman')?.count, 2)
})

test('reloading a full word bank preserves recency independently of display frequency', () => {
  const storage = memoryStorage()
  const words = Array.from({ length: 500 }, (_, index) => ({
    source: `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + index % 26)}`,
    reading: '\u0986\u09ae\u09bf', count: index === 499 ? 99 : 1,
  }))
  storage.setItem(BANGLISH_LEARN_KEY, JSON.stringify({ version: 1, words }))
  const result = saveLearnedWord('fresh', '\u0986\u09ae\u09bf', storage, loadSpellingChoices(storage))
  assert.equal(result.choices.length, 500)
  assert.equal(result.words[words[0].source], undefined)
  assert.equal(result.words[words[499].source], '\u0986\u09ae\u09bf')
  assert.equal(result.choices.find((entry) => entry.source === words[499].source)?.count, 99)
})

test('learned readings require Bengali letters and marks, including valid khanda ta', () => {
  for (const reading of ['\u09be\u0995', '\u200d\u0995', '\u0995\u09f3', '\u0995\u09f8', '\u09a9']) {
    assert.equal(isBengaliSpelling(reading), false, reading)
  }
  assert.equal(isBengaliSpelling('\u09ce'), true)
  assert.equal(isBengaliSpelling('\u09b0\u09bc'), true)
  assert.equal(isBengaliSpelling('\u0995\u09cd\u200d\u09a4'), true)
})

test('spelling validation uses the same normalized length as persistence', () => {
  const storage = memoryStorage()
  const limit = '\u09dc'.repeat(40)
  const oversized = '\u09dc'.repeat(41)
  assert.equal(isValidSpellingChoice('word', limit), true)
  assert.equal(saveLearnedWord('word', limit, storage).accepted, true)
  assert.equal(loadLearnedWords(storage).word.length, 80)
  assert.equal(isValidSpellingChoice('word', oversized), false)
  assert.equal(saveLearnedWord('word', oversized, storage).accepted, false)
})
