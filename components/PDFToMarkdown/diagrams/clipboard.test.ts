import assert from 'node:assert/strict'
import test from 'node:test'

import { isSelectionInsideDiagramFence, normalizeDiagramClipboardText } from './clipboard'

test('normalizes raw Mermaid copied on one line', () => {
  const result = normalizeDiagramClipboardText('flowchart LR; A[Upload] --> B[Convert]')

  assert.equal(result?.engine, 'mermaid')
  assert.equal(result?.markdown, '```mermaid\nflowchart LR;\nA[Upload] --> B[Convert]\n```')
})

test('recognizes a Plotly spec without an optional layout object', () => {
  const result = normalizeDiagramClipboardText('{"data":[{"x":[1,2],"y":[3,4],"type":"scatter"}]}')

  assert.equal(result?.engine, 'plotly')
  assert.match(result?.markdown ?? '', /^```plotly\n/)
})

test('does not classify arbitrary objects with a data array as Plotly', () => {
  assert.equal(normalizeDiagramClipboardText('{"data":[{"id":1,"title":"Example"}]}'), null)
})

test('recognizes common raw D2 edge syntax', () => {
  const result = normalizeDiagramClipboardText('Client -> API: request\nAPI -> Database: query')

  assert.equal(result?.engine, 'd2')
  assert.match(result?.markdown ?? '', /^```d2\n/)
})

test('keeps a pasted fenced diagram structured and preserves attributes', () => {
  const result = normalizeDiagramClipboardText('```mermaid {align="right"}\ngraph TD; A-->B\n```')

  assert.equal(result?.engine, 'mermaid')
  assert.match(result?.markdown ?? '', /^```mermaid \{align="right"\}\n/)
})

test('accepts an indented tilde fence with a longer Markdown-valid closer', () => {
  const result = normalizeDiagramClipboardText('  ~~~graphviz {layout="dot"}\ndigraph G { A -> B; }\n  ~~~~~')

  assert.equal(result?.engine, 'graphviz')
  assert.equal(result?.language, 'graphviz')
  assert.match(result?.markdown ?? '', /^```graphviz \{layout="dot"\}\n/)
  assert.match(result?.source ?? '', /^digraph G \{\n/)
})

test('does not consume surrounding prose as one fenced diagram', () => {
  const pasted = '```mermaid\ngraph TD\nA-->B\n```\nFollowing paragraph'

  assert.equal(normalizeDiagramClipboardText(pasted), null)
})

test('chooses a fence longer than backtick runs inside diagram source', () => {
  const result = normalizeDiagramClipboardText('flowchart LR\nA[```] --> B[Done]')

  assert.match(result?.markdown ?? '', /^````mermaid\n/)
  assert.match(result?.markdown ?? '', /\n````$/)
})

test('detects selections wholly inside diagram source only', () => {
  const markdown = 'Before\n\n```mermaid\ngraph TD\nA-->B\n```\n\nAfter'
  const sourceStart = markdown.indexOf('graph TD')

  assert.equal(isSelectionInsideDiagramFence(markdown, sourceStart, sourceStart + 5), true)
  assert.equal(isSelectionInsideDiagramFence(markdown, markdown.indexOf('```mermaid'), sourceStart), false)
  assert.equal(isSelectionInsideDiagramFence(markdown, sourceStart, markdown.indexOf('\n```', sourceStart)), true)
  assert.equal(isSelectionInsideDiagramFence(markdown, sourceStart, markdown.indexOf('```', sourceStart) + 1), false)
  assert.equal(isSelectionInsideDiagramFence(markdown, -1, 2), false)
})