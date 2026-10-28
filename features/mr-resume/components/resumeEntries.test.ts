import assert from 'node:assert/strict'
import test from 'node:test'
import { contactIconFor, entryHasLink, parseContactLine, parseEntryLine } from './resumeEntries.ts'

test('contactIconFor maps the schemes this template writes', () => {
  assert.equal(contactIconFor('mailto:me@example.com'), 'email')
  assert.equal(contactIconFor('tel:+8801700000000'), 'phone')
  assert.equal(contactIconFor('https://www.linkedin.com/in/ahmed-jishan'), 'linkedin')
  assert.equal(contactIconFor('https://github.com/ahmed-jishan'), 'github')
  assert.equal(contactIconFor('https://example.dev'), 'globe')
  assert.equal(contactIconFor('https://www.ghotok.com'), 'globe')
})

test('parseContactLine prefixes only linked contact lines', () => {
  assert.deepEqual(parseContactLine('[you@yourmail.com](mailto:you@yourmail.com)'), { icon: 'email', rest: '[you@yourmail.com](mailto:you@yourmail.com)' })
  assert.deepEqual(parseContactLine('plain note without any address'), { icon: null, rest: 'plain note without any address' })
  const line = '[portfolio](https://yoursite.dev)'
  const parsed = parseContactLine(line)
  assert.equal(parsed.icon, 'globe')
  assert.equal(parsed.rest, line)
})

test('parseEntryLine splits exactly on one unescaped pipe separator', () => {
  const entry = parseEntryLine('**SQA Engineer** _Akij ibos_ | Sep 2025 – Present')
  assert.ok(entry)
  assert.equal(entry.lead, '**SQA Engineer** _Akij ibos_')
  assert.equal(entry.meta, 'Sep 2025 – Present')
  assert.equal(entry.leadOffset, 0)
  assert.ok(entry.metaOffset > entry.leadOffset)
})

test('parseEntryLine rejects non-entry shapes instead of guessing', () => {
  assert.equal(parseEntryLine('A plain sentence about work.'), null)
  assert.equal(parseEntryLine('two pipes | one too | many'), null)
  assert.equal(parseEntryLine('empty side | '), null)
  assert.equal(parseEntryLine(' | empty lead'), null)
  assert.equal(parseEntryLine(''), null)
})

test('parseEntryLine keeps escaped pipes readable inside the lead', () => {
  const entry = parseEntryLine('C++ \\| generic | Sep 2025 – Present')
  assert.ok(entry)
  assert.equal(entry.lead, 'C++ \\| generic')
  assert.equal(entry.meta, 'Sep 2025 – Present')
})

test('parseEntryLine never shapes list items or titles', () => {
  assert.equal(parseEntryLine('- Duty one | 2025'), null)
  assert.equal(parseEntryLine('1. First | 2025'), null)
})

test('entry meta earns the external-link mark only through a real link', () => {
  assert.equal(entryHasLink('[repo](https://github.com/me/one)'), true)
  assert.equal(entryHasLink('plain date'), false)
  assert.equal(entryHasLink('broken [label]() syntax'), false)
})
