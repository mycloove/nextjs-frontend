import assert from 'node:assert/strict'
import test from 'node:test'

import { assertCompleteDiagramExport, type DiagramExportCompletion } from './export-contract'

function exportDocument(overrides: Partial<DiagramExportCompletion> = {}): DiagramExportCompletion {
  return {
    warnings: [],
    expectedDiagramCount: 1,
    renderedDiagramCount: 1,
    ...overrides,
  }
}

test('accepts an export only when every expected diagram rendered', () => {
  assert.doesNotThrow(() => assertCompleteDiagramExport(exportDocument()))
})

test('blocks PDF export when a diagram is missing', () => {
  assert.throws(
    () => assertCompleteDiagramExport(exportDocument({ renderedDiagramCount: 0 })),
    /PDF export stopped because one or more diagrams could not be rendered/,
  )
})

test('blocks PDF export when a renderer reports a warning', () => {
  assert.throws(
    () => assertCompleteDiagramExport(exportDocument({ warnings: ['Vega: Rendering failed.'] })),
    /PDF export stopped because Vega: Rendering failed/,
  )
})