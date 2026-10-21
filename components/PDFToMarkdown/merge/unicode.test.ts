import assert from 'node:assert/strict'
import test from 'node:test'

import { detectBijoy, normalizeBangla, toNfc } from './unicode.ts'

test('ordinary English is never flagged as Bijoy', () => {
  assert.equal(detectBijoy('Hello world, this is a normal English sentence.'), false)
  assert.equal(detectBijoy(''), false)
})

test('already-Unicode Bengali is not Bijoy (no needless conversion)', () => {
  assert.equal(detectBijoy('এটি ইতিমধ্যেই ইউনিকোড বাংলা।'), false)
})

test('a Windows-1252 extended glyph is a strong Bijoy signal', () => {
  assert.equal(detectBijoy('Avgvi evsjv † fvlv'), true)
})

test('vowel-starved v-heavy ASCII reads as Bijoy', () => {
  assert.equal(detectBijoy('Avgvi evsjv fvlv'), true)
})

test('toNfc composes canonically', () => {
  const decomposed = 'a\u0301'
  assert.equal(toNfc(decomposed), '\u00e1')
})

test('normalizeBangla tidies virama runs, trailing spaces and blank runs', () => {
  assert.equal(normalizeBangla('a\u09cd\u09cdb'), 'a\u09cdb')
  assert.equal(normalizeBangla('x   \ny'), 'x\ny')
  assert.equal(normalizeBangla('a\n\n\n\nb'), 'a\n\nb')
})
