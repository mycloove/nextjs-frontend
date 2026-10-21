import assert from 'node:assert/strict'
import test from 'node:test'

import { parseDocument } from './parse.ts'

test('fenced code is opaque — a # inside is not a heading', () => {
  const doc = parseDocument('# Real\n\n```\n# not a heading\n```\n\n## Second')
  assert.equal(doc.sections.length, 2)
  assert.equal(doc.sections[0].title, 'Real')
  assert.equal(doc.sections[1].title, 'Second')
  assert.match(doc.sections[0].body, /# not a heading/)
})

test('setext underline becomes a heading, not a body line', () => {
  const doc = parseDocument('Title\n=====\n\nbody text')
  assert.equal(doc.sections.length, 1)
  assert.equal(doc.sections[0].title, 'Title')
  assert.equal(doc.sections[0].level, 1)
  assert.equal(doc.sections[0].style, 'setext')
  assert.equal(doc.sections[0].body, 'body text')
  assert.equal(doc.preamble, '')
  assert.equal(doc.setextCount, 1)
})

test('a leading frontmatter block is separated from the body', () => {
  const doc = parseDocument('---\ntitle: X\nauthor: me\n---\n# H\n\nBody')
  assert.equal(doc.frontmatter, '---\ntitle: X\nauthor: me\n---')
  assert.equal(doc.sections.length, 1)
  assert.equal(doc.sections[0].title, 'H')
  assert.equal(doc.sections[0].body, 'Body')
})

test('a --- that is not frontmatter is treated as content', () => {
  const doc = parseDocument('# H\n\n---\n\nBody')
  assert.equal(doc.frontmatter, null)
  assert.equal(doc.sections.length, 1)
})

test('BOM and CRLF are normalised but reported', () => {
  const doc = parseDocument('\uFEFF# H\r\n\r\nBody\r\n')
  assert.equal(doc.hadBom, true)
  assert.equal(doc.crlf, true)
  assert.equal(doc.sections[0].title, 'H')
})

test('preamble before the first heading is preserved', () => {
  const doc = parseDocument('Intro paragraph\n\n# First\n\nbody')
  assert.equal(doc.preamble, 'Intro paragraph')
  assert.equal(doc.sections.length, 1)
})

test('empty and heading-less documents are handled without throwing', () => {
  assert.equal(parseDocument('').sections.length, 0)
  assert.equal(parseDocument('').titleGuess, null)
  const plain = parseDocument('just some text\nmore text')
  assert.equal(plain.sections.length, 0)
  assert.equal(plain.preamble, 'just some text\nmore text')
})

test('an explicit {#anchor} on a heading does not leak into the title', () => {
  const doc = parseDocument('## Setup {#custom}')
  assert.equal(doc.sections[0].title, 'Setup')
})
