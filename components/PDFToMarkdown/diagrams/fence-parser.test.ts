import assert from 'node:assert/strict'
import test from 'node:test'

import { parseDiagramFences } from './fence-parser'

const VEGA_SPEC = `{
  "$schema": "https://vega.github.io/schema/vega/v6.json",
  "width": 400,
  "height": 200,
  "data": [{"name": "table", "values": [{"category": "A", "value": 28}]}],
  "marks": [{"type": "rect", "from": {"data": "table"}}]
}`

test('recognizes an explicitly labelled Vega fence', () => {
  const blocks = parseDiagramFences(`Before\n\n\`\`\`vega\n${VEGA_SPEC}\n\`\`\`\n\nAfter`)

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].engine, 'vega')
  assert.equal(blocks[0].source, VEGA_SPEC)
})

test('recognizes a Vega schema inside a generic JSON fence', () => {
  const blocks = parseDiagramFences(`\`\`\`json\n${VEGA_SPEC}\n\`\`\``)

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].engine, 'vega')
})

test('recognizes Vega-Lite schema inside an unlabeled fence', () => {
  const source = VEGA_SPEC.replace('/vega/v6.json', '/vega-lite/v6.json')
  const blocks = parseDiagramFences(`\`\`\`\n${source}\n\`\`\``)

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].engine, 'vega-lite')
})

test('does not classify arbitrary JSON as a diagram', () => {
  const blocks = parseDiagramFences('```json\n{"data":[{"id":1}]}\n```')

  assert.equal(blocks.length, 0)
})