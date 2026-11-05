import assert from 'node:assert/strict'
import test from 'node:test'
import { EditorState, Transaction, type Transaction as EditorTransaction } from '@codemirror/state'
import { history, redo, undo, undoDepth } from '@codemirror/commands'
import { checkLocalDiagnostics, compilerEditorDiagnostics } from './editorDiagnostics.ts'
import { reviewDiagnosticFix, reviewedSourceFixTransaction, reviewSourceFix, type SourceFixHunk } from './editorFixes.ts'
import { sourceLineSeparator } from './editorHelpers.ts'
import { validateLatexProject } from './project.ts'
import type { LatexDiagnostic, LatexProject } from './types.ts'

function project(source: string, extra = 'other source'): LatexProject {
  return validateLatexProject({ version: 1, id: 'fix-test', title: 'Fix fixture', revision: 1, mainFile: 'main.tex', engine: 'xelatex',
    files: [{ id: 'main', path: 'main.tex', content: source }, { id: 'other', path: 'other.tex', content: extra }], assets: [], templateId: null, templateVersion: null,
    createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z' })
}
const description = { kind: 'known-command-typo' as const, runtime: 'browser' as const, title: 'Review correction', explanation: 'Exact source-only proposal.' }
const compilerIssue = (source: LatexProject, diagnostic: Partial<LatexDiagnostic> = {}) => compilerEditorDiagnostics(source, [{ severity: 'error', file: 'main.tex', line: 1,
  message: 'Undefined control sequence.', help: 'Undefined control sequence: \\sectoin', ...diagnostic }], 'browser')[0]

test('known typo proposals require a named compiler error, not an unknown-command regex', () => {
  const source = project('\\sectoin{Writing}'), review = reviewDiagnosticFix(source, compilerIssue(source))!
  assert.equal(review.kind, 'known-command-typo')
  assert.equal(review.before, '\\sectoin{Writing}')
  assert.equal(review.after, '\\section{Writing}')
  assert.deepEqual(review.hunks, [{ from: 0, to: 8, expectedText: '\\sectoin', replacement: '\\section' }])
  assert.ok(Object.isFrozen(review) && Object.isFrozen(review.snapshot.files[0]) && Object.isFrozen(review.hunks[0]))
  for (const diagnostic of [{ help: undefined }, { severity: 'warning' as const }, { line: 0 }, { file: 'unknown.tex' }, { message: 'Unknown command maybe' }, { help: 'Undefined control sequence: \\other' }]) {
    assert.equal(reviewDiagnosticFix(source, compilerIssue(source, diagnostic)), null)
  }
  const custom = project('\\customcommand{Writing}')
  assert.equal(reviewDiagnosticFix(custom, compilerIssue(custom, { help: 'Undefined control sequence: \\customcommand' })), null)
  const importedMacro = project('\\input{other}\n\\sectoin{Writing}', '\\newcommand{\\sectoin}[1]{\\missing{#1}}')
  assert.equal(reviewDiagnosticFix(importedMacro, compilerIssue(importedMacro, { line: 2 })), null)
})

test('environment fix changes only one provable literal closing name and refuses macro/import ambiguity', () => {
  const source = project('\\begin{itemize}\r\n\\item Writing\r\n\\end{enumerate}')
  const hint = checkLocalDiagnostics(source, 'main')!.hints.find((item) => item.diagnostic.code === 'local_environment_mismatch')!
  const review = reviewDiagnosticFix(source, hint)!
  assert.equal(review.kind, 'environment-end')
  assert.equal(review.hunks[0].expectedText, 'enumerate')
  assert.equal(review.hunks[0].replacement, 'itemize')
  const compiler = compilerIssue(source, { line: 3, message: 'LaTeX Error: \\begin{itemize} on input line 1 ended by \\end{enumerate}.', help: undefined })
  assert.ok(reviewDiagnosticFix(source, compiler))
  assert.equal(reviewDiagnosticFix(source, { ...compiler, diagnostic: { ...compiler.diagnostic, message: '\\begin{itemize} on input line 9 ended by \\end{enumerate}.' } }), null)
  for (const prefix of ['\\input{other}\n', '\\ifcustom\n', '\\newcommand{\\x}{x}\n']) {
    const ambiguous = project(prefix + source.files[0].content)
    assert.equal(reviewDiagnosticFix(ambiguous, compilerIssue(ambiguous, { ...compiler.diagnostic, line: 4 })), null)
  }
  const custom = project('\\begin{custom}\n\\end{itemize}')
  assert.equal(reviewDiagnosticFix(custom, checkLocalDiagnostics(custom, 'main')!.hints[0]), null)
  const crossed = project('\\begin{itemize}\n\\begin{enumerate}\n\\end{itemize}\n\\end{enumerate}')
  assert.equal(reviewDiagnosticFix(crossed, checkLocalDiagnostics(crossed, 'main')!.hints[0]), null, 'Crossed nesting may need an inserted end, not a renamed one')
})

test('one isolated CodeMirror transaction preserves exact Unicode and LF/CRLF/CR/mixed endings through Undo and Redo', () => {
  const endings = ['\n', '\r\n', '\r']
  const sources = endings.map((newline) => `\ufeff\u0995\u09cd\u200d\u09b7 \ud83d\ude00${newline}\\sectoin{Heading}${newline}keep`)
  sources.push('\ufeff\u0995\r\n\\sectoin{Heading}\nKeep\rLast')
  for (const original of sources) {
    const source = project(original), review = reviewDiagnosticFix(source, compilerIssue(source, { line: 2 }))!
    let state = EditorState.create({ doc: original, extensions: [EditorState.lineSeparator.of(sourceLineSeparator(original)), history()] })
    let changes = 0
    const target = { get state() { return state }, dispatch(transaction: EditorTransaction) { state = transaction.state; changes++ } }
    let validated = ''
    target.dispatch(reviewedSourceFixTransaction(state, source, 'main', 'browser', review, (_file, text) => { validated = text; return null }))
    assert.equal(changes, 1)
    assert.equal(state.sliceDoc(), original.replace('\\sectoin', '\\section'))
    assert.equal(validated, state.sliceDoc())
    assert.equal(undoDepth(state), 1)
    assert.equal(undo(target), true)
    assert.equal(state.sliceDoc(), original)
    assert.equal(redo(target), true)
    assert.equal(state.sliceDoc(), validated)
  }
})

test('multiple hunks apply together, and neighboring typing cannot merge into the reviewed Undo step', () => {
  const original = 'aa bb cc\r\n'
  let state = EditorState.create({ doc: original, extensions: [EditorState.lineSeparator.of('\r\n'), history({ newGroupDelay: 10000 })] })
  const target = { get state() { return state }, dispatch(transaction: EditorTransaction) { state = transaction.state } }
  target.dispatch(state.update({ changes: { from: 0, insert: 'X' }, annotations: Transaction.userEvent.of('input.type') }))
  const before = state.sliceDoc(), source = project(before)
  const hunks = [{ from: 1, to: 3, expectedText: 'aa', replacement: 'AA' }, { from: 7, to: 9, expectedText: 'cc', replacement: 'CC' }]
  const review = reviewSourceFix(source, 'main', hunks, description)
  target.dispatch(reviewedSourceFixTransaction(state, source, 'main', 'browser', review, () => null))
  const after = state.sliceDoc()
  target.dispatch(state.update({ changes: { from: state.doc.length, insert: 'Y' }, annotations: Transaction.userEvent.of('input.type') }))
  assert.equal(undo(target), true); assert.equal(state.sliceDoc(), after)
  assert.equal(undo(target), true); assert.equal(state.sliceDoc(), before)
  assert.equal(undo(target), true); assert.equal(state.sliceDoc(), original)
})

test('same-rN forks in any file, settings, file and runtime changes all refuse reviewed apply', () => {
  const original = project('\\sectoin{Writing}'), review = reviewDiagnosticFix(original, compilerIssue(original))!
  const state = EditorState.create({ doc: original.files[0].content })
  const variants = [
    { ...original, id: 'other-project' }, { ...original, revision: 2 }, { ...original, mainFile: 'other.tex' }, { ...original, engine: 'pdflatex' as const },
    { ...original, files: original.files.map((file) => file.id === 'other' ? { ...file, content: 'same-rN fork' } : file) },
    { ...original, files: original.files.map((file) => file.id === 'main' ? { ...file, content: '\\sectoin{New writing}' } : file) },
  ]
  for (const variant of variants) assert.throws(() => reviewedSourceFixTransaction(state, variant, 'main', 'browser', review, () => null), /changed|reviewed source/u)
  assert.throws(() => reviewedSourceFixTransaction(state, original, 'main', 'native', review, () => null), /changed/u)
  assert.throws(() => reviewedSourceFixTransaction(state, original, 'other', 'browser', review, () => null), /changed/u)
  assert.throws(() => reviewedSourceFixTransaction(state.update({ changes: { from: 0, insert: 'unreported' } }).state, original, 'main', 'browser', review, () => null), /exact reviewed source/u)
  assert.equal(state.sliceDoc(), original.files[0].content)
})

test('bad expectedText, overlapping/reversed/outside ranges, split Unicode/CRLF and altered previews fail closed', () => {
  const input = project('\ud83d\ude00 aa\r\nbb'), hunk = { from: 3, to: 5, expectedText: 'aa', replacement: 'AA' }
  const bad: SourceFixHunk[][] = [
    [{ ...hunk, expectedText: 'bb' }], [{ ...hunk, from: -1 }], [{ ...hunk, to: 99 }], [{ ...hunk, from: 5, to: 3 }],
    [{ ...hunk, from: 3.5 }], [{ from: 1, to: 2, expectedText: '\ude00', replacement: 'x' }], [{ from: 5, to: 6, expectedText: '\r', replacement: '' }],
    [hunk, { ...hunk, from: 4, to: 5, expectedText: 'a' }], [{ ...hunk, replacement: '\ud800' }],
    [{ from: 3, to: 3, expectedText: '', replacement: 'x' }, { from: 3, to: 3, expectedText: '', replacement: 'y' }],
  ]
  for (const hunks of bad) assert.throws(() => reviewSourceFix(input, 'main', hunks, description), /hunk|bounds|expected/u)
  const review = reviewSourceFix(input, 'main', [hunk], description), state = EditorState.create({ doc: input.files[0].content, extensions: [EditorState.lineSeparator.of('\r\n')] })
  assert.throws(() => reviewedSourceFixTransaction(state, input, 'main', 'browser', { ...review, after: 'not reviewed' }, () => null), /altered/u)
  assert.throws(() => reviewSourceFix(input, 'main', [{ ...hunk, replacement: 'x'.repeat(4097) }], description), /budget/u)
})

test('the existing source validator and real CodeMirror transaction filter can refuse without dispatch or mutation', () => {
  const source = project('\\sectoin{Writing}'), review = reviewDiagnosticFix(source, compilerIssue(source))!
  const state = EditorState.create({ doc: source.files[0].content })
  assert.throws(() => reviewedSourceFixTransaction(state, source, 'main', 'browser', review, () => 'Source limit reached'), /Source limit reached/u)
  const filtered = EditorState.create({ doc: source.files[0].content, extensions: [EditorState.transactionFilter.of((transaction) => transaction.docChanged ? [] : transaction)] })
  assert.throws(() => reviewedSourceFixTransaction(filtered, source, 'main', 'browser', review, () => null), /editor refused/u)
  const readOnly = EditorState.create({ doc: source.files[0].content, extensions: [EditorState.readOnly.of(true)] })
  assert.throws(() => reviewedSourceFixTransaction(readOnly, source, 'main', 'browser', review, () => null), /changed/u)
  assert.equal(state.sliceDoc(), source.files[0].content)
  assert.equal(filtered.sliceDoc(), source.files[0].content)
})
