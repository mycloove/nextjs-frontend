import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeAutoScrollVelocity } from './dragAutoScroll.ts'

const RECT = { left: 100, right: 500 } // 400px wide
const MAX = 20
const ZONE = 80

test('the neutral middle does not scroll', () => {
  assert.equal(computeAutoScrollVelocity(300, RECT, MAX, ZONE), 0)
  assert.equal(computeAutoScrollVelocity(420, RECT, MAX, ZONE), 0)
})

test('inside the left zone scrolls left, faster toward the edge', () => {
  const soft = computeAutoScrollVelocity(160, RECT, MAX, ZONE) // 60px in
  const hard = computeAutoScrollVelocity(120, RECT, MAX, ZONE) // 20px in
  assert.ok(soft < 0 && hard < 0)
  assert.ok(hard < soft, 'closer to the edge must scroll harder')
})

test('the exact left and right edges hit full speed', () => {
  assert.equal(computeAutoScrollVelocity(100, RECT, MAX, ZONE), -MAX)
  assert.equal(computeAutoScrollVelocity(500, RECT, MAX, ZONE), MAX)
})

test('a pointer dragged past the edge is clamped to full speed', () => {
  assert.equal(computeAutoScrollVelocity(0, RECT, MAX, ZONE), -MAX)
  assert.equal(computeAutoScrollVelocity(900, RECT, MAX, ZONE), MAX)
})

test('inside the right zone scrolls right, faster toward the edge', () => {
  const soft = computeAutoScrollVelocity(440, RECT, MAX, ZONE) // 60px in
  const hard = computeAutoScrollVelocity(480, RECT, MAX, ZONE) // 20px in
  assert.ok(soft > 0 && hard > 0)
  assert.ok(hard > soft, 'closer to the edge must scroll harder')
})

test('an overlapping-narrow strip resolves to the nearer edge', () => {
  const narrow = { left: 0, right: 100 } // both zones cover the whole strip
  const towardLeft = computeAutoScrollVelocity(10, narrow, MAX, ZONE)
  const towardRight = computeAutoScrollVelocity(90, narrow, MAX, ZONE)
  assert.ok(towardLeft < 0, 'nearer the left edge scrolls left')
  assert.ok(towardRight > 0, 'nearer the right edge scrolls right')
})

test('degenerate boxes and zones never scroll', () => {
  assert.equal(computeAutoScrollVelocity(50, { left: 100, right: 100 }, MAX, ZONE), 0)
  assert.equal(computeAutoScrollVelocity(50, { left: 200, right: 100 }, MAX, ZONE), 0)
  assert.equal(computeAutoScrollVelocity(150, RECT, MAX, 0), 0)
  assert.equal(computeAutoScrollVelocity(150, RECT, 0, ZONE), 0)
})
