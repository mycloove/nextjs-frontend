import assert from 'node:assert/strict'
import test from 'node:test'
import { EditorSelection, EditorState } from '@codemirror/state'
import { environmentFold, latexSnippets, sourceLineSeparator } from './editorHelpers.ts'

test('CodeMirror source state retains CRLF, raw Unicode/joiners and per-file selection independently', () => {
  const first = 'First\r\nক্\u200dষ #&%\r\n', second = '\\section*{Second}\n'
  const files = new Map<string, EditorState>()
  files.set('first', EditorState.create({ doc: first, selection: EditorSelection.cursor(7), extensions: [EditorState.lineSeparator.of(sourceLineSeparator(first))] }))
  files.set('second', EditorState.create({ doc: second, selection: EditorSelection.cursor(3), extensions: [EditorState.lineSeparator.of(sourceLineSeparator(second))] }))
  const state = files.get('first')!, edited = state.update({ changes: { from: 0, insert: '\\% ' } }).state
  files.set('first', edited)
  assert.equal(files.get('first')!.sliceDoc(), '\\% ' + first)
  assert.equal(files.get('second')!.sliceDoc(), second)
  assert.equal(files.get('second')!.selection.main.head, 3)
  assert.equal(files.get('first')!.selection.main.head, state.selection.main.head + 3)
})

test('line-separator selection supports LF/CRLF/CR and leaves mixed separators in raw source', () => {
  assert.equal(sourceLineSeparator('a\r\nb\r\n'), '\r\n')
  assert.equal(sourceLineSeparator('a\rb\r'), '\r')
  assert.equal(sourceLineSeparator('a\nb\n'), '\n')
  assert.equal(sourceLineSeparator('a\r\nb\n'), '\n')
  const mixed = 'a\r\nb\n'
  assert.equal(EditorState.create({ doc: mixed, extensions: [EditorState.lineSeparator.of(sourceLineSeparator(mixed))] }).sliceDoc(), mixed)
})

test('environment folding matches nested environments and ignores comments without guessing unmatched ends', () => {
  const source = '\\begin{itemize}\r\nitem\r\n\\begin{itemize}\r\nnested\r\n\\end{itemize}\r\n\\end{itemize}'
  const fold = environmentFold(source, 1)!
  assert.equal(fold.endLine, 6)
  assert.equal(source.slice(fold.to), '\\end{itemize}')
  assert.equal(environmentFold('% \\begin{itemize}\nbody\n\\end{itemize}', 1), null)
  assert.equal(environmentFold('\\begin{itemize}\nbody', 1), null)
  assert.equal(environmentFold('\\begin{itemize}\\end{itemize}', 1), null)
})

test('curated completions use real placeholders and paired environments, with no AI/network templates', () => {
  assert.ok(latexSnippets.some((item) => item.label === '\\input'))
  assert.ok(latexSnippets.some((item) => item.label === '\\addbibresource'))
  assert.ok(latexSnippets.every((item) => item.template.includes('${1:')))
  const environment = latexSnippets.find((item) => item.label === '\\begin')!
  assert.equal(environment.template.split('${1:environment}').length, 3)
})
