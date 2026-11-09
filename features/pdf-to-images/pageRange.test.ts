import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { describePages, parsePageRange } from './pageRange.ts'

/**
 * Pins parity with the engine's grammar (test_pdf_to_images.py uses the same
 * cases). Run with `npm run test:pdf-to-images`.
 */

const pagesOf = (spec: string, count = 12) => {
  const result = parsePageRange(spec, count)
  assert.ok(result.ok, JSON.stringify(result))
  return result.pages
}

const codeOf = (spec: string, count = 12) => {
  const result = parsePageRange(spec, count)
  assert.ok(!result.ok, `expected "${spec}" to be refused`)
  return result.code
}

test('accepts the same shapes as the engine', () => {
  assert.deepEqual(pagesOf(''), Array.from({ length: 12 }, (_, i) => i + 1))
  assert.deepEqual(pagesOf('all'), Array.from({ length: 12 }, (_, i) => i + 1))
  assert.deepEqual(pagesOf('3-5'), [3, 4, 5])
  assert.deepEqual(pagesOf('1-3, 5, 8-'), [1, 2, 3, 5, 8, 9, 10, 11, 12])
  assert.deepEqual(pagesOf(' 7 , 2 ,2'), [2, 7])
  assert.deepEqual(pagesOf('12'), [12])
})

test('refuses the same shapes as the engine, with the same codes', () => {
  for (const spec of ['abc', '0', '5-3', '-4', ',']) assert.equal(codeOf(spec), 'invalid_range', spec)
  for (const spec of ['13', '10-20']) assert.equal(codeOf(spec), 'page_out_of_range', spec)
})

test('an out-of-range message names the real page count', () => {
  const result = parsePageRange('10-20', 12)
  assert.ok(!result.ok)
  assert.match(result.error, /has 12 pages/)
  const single = parsePageRange('2', 1)
  assert.ok(!single.ok)
  assert.match(single.error, /has 1 page\./)
})

test('a range that covers everything is reported as all', () => {
  const result = parsePageRange('1-12', 12)
  assert.ok(result.ok && result.all)
  const partial = parsePageRange('1-11', 12)
  assert.ok(partial.ok && !partial.all)
})

test('describePages compacts consecutive runs', () => {
  assert.equal(describePages([1, 2, 3, 5, 8, 9, 10]), '1–3, 5, 8–10')
  assert.equal(describePages([4]), '4')
  assert.equal(describePages([]), '')
})
