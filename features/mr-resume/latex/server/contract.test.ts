import assert from 'node:assert/strict'
import test from 'node:test'
import { LATEX_LIMITS, type LatexSyncQuery } from '../types.ts'
import { readLatexDiagnostics, readLatexSyncQuery, readLatexSyncResult } from './contract.ts'

const inverse: LatexSyncQuery = { operationKey: 'operation-00000001', snapshotHash: 'a'.repeat(64), pdfHash: 'b'.repeat(64), direction: 'inverse', page: 1, x: 1, y: 1 }
const location = { page: 1, x: 0, y: 0, width: 1, height: 1 }

test('diagnostic and synchronization line bounds match the full backend source-byte limit', () => {
  const line = LATEX_LIMITS.sourceBytes
  const query = { operationKey: inverse.operationKey, snapshotHash: inverse.snapshotHash, pdfHash: inverse.pdfHash, direction: 'forward', file: 'main.tex', line }
  assert.equal(readLatexDiagnostics([{ severity: 'warning', message: 'An actual high source line', file: 'main.tex', line }])[0].line, line)
  assert.equal(readLatexSyncQuery(query).direction, 'forward')
  assert.equal(readLatexSyncResult({ available: true, file: 'main.tex', line, locations: [location] }, inverse).line, line)
  assert.throws(() => readLatexDiagnostics([{ severity: 'warning', message: 'Outside the source budget', line: line + 1 }]))
  assert.throws(() => readLatexSyncQuery({ ...query, line: line + 1 }))
  assert.throws(() => readLatexSyncResult({ available: true, file: 'main.tex', line: line + 1, locations: [location] }, inverse))
})

test('unmapped forward lines remain unavailable without inventing file/line navigation', () => {
  const query = readLatexSyncQuery({ operationKey: inverse.operationKey, snapshotHash: inverse.snapshotHash, pdfHash: inverse.pdfHash, direction: 'forward', file: 'main.tex', line: 2 })
  assert.deepEqual(readLatexSyncResult({ available: false, locations: [] }, query), { available: false, locations: [] })
  assert.throws(() => readLatexSyncResult({ available: false, file: 'main.tex', line: 2, locations: [] }, query))
})
