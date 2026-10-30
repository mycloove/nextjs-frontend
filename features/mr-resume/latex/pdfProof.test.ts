import assert from 'node:assert/strict'
import test from 'node:test'
import { copyProofBytes, proofBitmapSize, proofPoint, proofSourceBox } from './pdfProof.ts'

test('renderer transfer never consumes or changes canonical download bytes', () => {
  const original = new TextEncoder().encode('%PDF-1.7\nproof bytes\n%%EOF').buffer
  const before = new Uint8Array(original).slice()
  const rendered = copyProofBytes(original, original.byteLength)
  assert.notEqual(rendered.buffer, original)
  structuredClone(rendered, { transfer: [rendered.buffer] })
  assert.equal(rendered.byteLength, 0)
  assert.deepEqual(new Uint8Array(original), before)
})

test('missing, mismatched and oversized artifacts are not presented as PDF proofs', () => {
  assert.throws(() => copyProofBytes(new ArrayBuffer(10), 10))
  const data = new TextEncoder().encode('%PDF-1.7').buffer
  assert.throws(() => copyProofBytes(data, 100))
  assert.throws(() => copyProofBytes(new ArrayBuffer(4 * 1024 * 1024), 4 * 1024 * 1024))
})

test('page rasterization has a real dimension, memory and density budget', () => {
  assert.deepEqual(proofBitmapSize(600, 800, 3), { width: 1200, height: 1600, density: 2 })
  for (const [width, height, density] of [[NaN, 10, 1], [100, Infinity, 1], [-1, 10, 1], [1000000, 10, 1], [8000, 8000, 1], [10, 10, 0]]) assert.throws(() => proofBitmapSize(width, height, density))
})

const viewport = {
  width: 200, height: 300,
  convertToViewportRectangle: ([x1, y1, x2, y2]: number[]) => [x1 * 2, 300 - y1 * 2, x2 * 2, 300 - y2 * 2],
  convertToPdfPoint: (x: number, y: number) => [x / 2, (300 - y) / 2],
}

test('measured SyncTeX boxes use the PDF viewport transform, with no guessed positions', () => {
  assert.deepEqual(proofSourceBox({ page: 1, x: 10, y: 20, width: 30, height: 10 }, viewport), { left: 20, top: 240, width: 60, height: 20 })
  assert.equal(proofSourceBox({ page: 1, x: 10, y: 20, width: 0, height: 10 }, viewport), null)
  assert.equal(proofSourceBox({ page: 1, x: 1000, y: 1000, width: 10, height: 10 }, viewport), null)
})

test('inverse navigation converts actual scaled pointer coordinates back into PDF points', () => {
  const bounds = { left: 30, top: 40, width: 400, height: 600 }
  assert.deepEqual(proofPoint(70, 100, bounds, viewport), { x: 10, y: 135 })
  assert.equal(proofPoint(0, 0, bounds, viewport), null)
  assert.equal(proofPoint(70, 100, { ...bounds, width: 0 }, viewport), null)
})
