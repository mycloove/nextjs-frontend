import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'
import { diagnosticCount, forEachDiagnostic } from '@codemirror/lint'
import { checkLocalDiagnostics, compilerEditorDiagnostics, editorDiagnosticsExtension, exactDiagnosticLine, exactSourceRange, inspectLatexSource, LOCAL_CHECK_DELAY, LOCAL_CHECK_MAX_UNITS,
  mergedEditorDiagnostics, refreshEditorDiagnostics, shouldCheckLocalSource, sourceRangeToEditor, undefinedControlSequence } from './editorDiagnostics.ts'
import { sourceLineSeparator } from './editorHelpers.ts'
import { validateLatexProject } from './project.ts'
import type { LatexDiagnostic, LatexProject } from './types.ts'

function project(content: string, other: Record<string, string> = {}): LatexProject {
  return validateLatexProject({ version: 1, id: 'editor-test', title: 'Editor fixture', revision: 1, mainFile: 'main.tex', engine: 'xelatex',
    files: Object.entries({ 'main.tex': content, ...other }).map(([path, content], index) => ({ id: `f-${index}`, path, content })), assets: [], templateId: null, templateVersion: null,
    createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z' })
}
const local = (source: string) => checkLocalDiagnostics(project(source), 'f-0')!

test('local checks find literal braces, environment mismatch and explicit math delimiters without compile blockers', () => {
  const source = '{} } {\n\\begin{itemize}\n\\item Writing\n\\end{enumerate}\n\\[x\\)'
  const result = local(source)
  assert.deepEqual(result.hints.map((hint) => hint.diagnostic.code), ['local_unmatched_close_brace', 'local_unmatched_open_brace', 'local_environment_mismatch', 'local_incomplete_delimiter'])
  assert.deepEqual(result.hints.map((hint) => source.slice(hint.range!.from, hint.range!.to)), ['}', '{', 'enumerate', '\\)'])
  assert.ok(result.hints.every((hint) => hint.origin === 'local' && hint.diagnostic.severity === 'warning' && hint.diagnostic.help?.includes('not a compiler error')))
  assert.equal(Object.hasOwn(result, 'canCompile'), false)
  assert.equal(local('{}').hints.length, 0, 'An opening brace at offset zero is a real stack entry')
})

test('comments and escaped percent/braces respect odd/even backslashes', () => {
  const sources = [
    '% { \\begin{itemize} \\(\nPlain', '\\{literal\\} \\% plain', '\\\\% { commented after a line break command',
    '\\\\\\% literal percent and {paired}', '\\% percent % { ignored', '% \\catcode`\\{=12\n{balanced}',
    '\\begin% example\n{itemize}\n\\end{itemize}',
  ]
  for (const source of sources) assert.equal(local(source).hints.length, 0, source)
  assert.equal(local('\\% {').hints.length, 1, 'Escaping percent does not hide the rest of the line')
})

test('verb and verbatim/listings/minted/comment bodies never contribute structural tokens', () => {
  const examples = [
    '\\verb|{ % \\ifcustom \\end{bad}|', '\\verb*+} {+ \\verb|} { %|', '\\verb\ud83d\ude00{ % \ud83d\ude00',
    ...['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment'].map((name) => `\\begin{${name}}[extra]{latex}\n{ % \\ifcustom \\end{wrong}\n\\end{${name}}`),
  ]
  for (const source of examples) {
    const scan = inspectLatexSource(source)
    assert.equal(scan.visible.length, source.length)
    assert.equal(local(source).hints.length, 0, source)
    assert.equal(local(source).status, 'checked', source)
  }
  assert.equal(local('\\verb|incomplete {\nBalanced').hints[0].diagnostic.code, 'local_incomplete_delimiter')
  for (const source of ['\\begin{verbatim}\n{', '\\lstinline[language=TeX]|{|', '\\mintinline{tex}|{|']) {
    assert.equal(local(source).status, 'undetermined')
    assert.equal(local(source).hints.length, 0)
  }
  assert.equal(local('\\begin{minted}{python}\nprint("\\end{minted}")\n{ % literal\n\\end{minted}').hints.length, 0, 'An inline quoted closer does not expose the rest of a literal body')
})

test('macro definitions, unknown conditionals, category codes and nonliteral grouping are undetermined', () => {
  const examples = [
    '\\newcommand{\\opening}{\\begin{itemize}} {', '\\def\\close{\\end{itemize}} }', '\\let\\close\\egroup {',
    '\\newenvironment{resume}{\\begin{itemize}}{\\end{itemize}} {', '\\NewDocumentCommand{\\x}{m}{#1} {',
    '\\ifcustom { \\else } \\fi', '\\iffalse { \\fi', '\\catcode`\\{=12 {', '\\csname macro\\endcsname {',
    '\\begingroup Writing\\egroup', '\\ExplSyntaxOn {', '^^7b', '\\IfFileExists{x}{ }{ { }',
  ]
  for (const source of examples) {
    const result = local(source)
    assert.equal(result.status, 'undetermined', source)
    assert.equal(result.hints.length, 0, source)
    assert.ok(result.reason)
  }
})

test('fragments, cross-file constructs, arbitrary Unicode and unknown commands are not treated as invalid', () => {
  const source = '\\UnknownCommand{\u0995\u09cd\u200d\u09b7 \ud83d\ude00} $20; arbitrary writing'
  assert.equal(local(source).hints.length, 0)
  assert.equal(local('\\section{A fragment, no document wrapper}').hints.length, 0)
  const split = project('\\begin{itemize}\n\\input{part}\n', { 'part.tex': '\\end{itemize}\n} { \\(' })
  assert.equal(checkLocalDiagnostics(split, 'f-0')!.status, 'undetermined')
  assert.equal(checkLocalDiagnostics(split, 'f-0')!.hints.length, 0)
  assert.equal(checkLocalDiagnostics(split, 'f-1')!.hints.length, 0)
  const nested = project('\\input{part}', { 'part.tex': '\\begin{itemize}\n\\end{enumerate}' })
  assert.equal(checkLocalDiagnostics(nested, 'f-1')!.hints[0].diagnostic.code, 'local_environment_mismatch')
  assert.equal(local('\\endinput\n{').hints.length, 0)
})

test('local checks are bounded, active-visible only, and skip IME without modifying source', () => {
  assert.equal(LOCAL_CHECK_DELAY, 350)
  for (const state of [{ active: false, visible: true, composing: false }, { active: true, visible: false, composing: false }, { active: true, visible: true, composing: true }]) {
    assert.equal(shouldCheckLocalSource(state), false)
    const source = project('{'), report = checkLocalDiagnostics(source, 'f-0', 'browser', state)!
    assert.equal(report.status, 'skipped'); assert.equal(report.hints.length, 0); assert.equal(source.files[0].content, '{')
  }
  assert.equal(shouldCheckLocalSource({ active: true, visible: true, composing: false }), true)
  assert.equal(local('x'.repeat(LOCAL_CHECK_MAX_UNITS + 1)).status, 'undetermined')
  assert.equal(local('\n'.repeat(4096) + '{').status, 'undetermined', 'Line-dense files also respect the idle analysis budget')
  assert.equal(local('{'.repeat(100)).hints.length, 40)
  assert.equal(inspectLatexSource('\ud800').bounded, false)
  assert.equal(checkLocalDiagnostics(project('text', { 'notes.txt': '{' }), 'f-1')!.status, 'skipped')
})

test('masks and ranges preserve UTF-16 positions, BOM, joiners, CRLF, lone CR and mixed line endings', () => {
  for (const source of ['\ufeff\ud83d\ude00\n\u0995\u09cd\u200d\u09b7 {', '\ufeff\ud83d\ude00\r\n\u0995\u09cd\u200d\u09b7 {', '\ufeffA\rB {', '\ufeffA\r\nB\nC\r{']) {
    const result = local(source), range = result.hints[0].range!
    assert.equal(range.from, source.indexOf('{'))
    assert.equal(source.slice(range.from, range.to), '{')
    const state = EditorState.create({ doc: source, extensions: [EditorState.lineSeparator.of(sourceLineSeparator(source))] })
    const converted = sourceRangeToEditor(source, range, state.lineBreak)!
    assert.equal(state.sliceDoc(converted.from, converted.to), '{')
    assert.equal(state.sliceDoc(), source)
  }
  const source = '% \ud83d\ude00 {\r\n\\verb|\ud83d\ude00 {|\n{'
  assert.equal(inspectLatexSource(source).visible.length, source.length)
  assert.equal(local(source).hints[0].range!.from, source.lastIndexOf('{'))
})

test('invalid diagnostic locations stay unlocated, not clamped; exact ranges refuse split code points and CRLF', () => {
  const source = '\ud83d\ude00\r\nB\rC\n'
  for (const line of [undefined, 0, -1, 1.5, NaN, Infinity, 20]) assert.equal(exactDiagnosticLine(source, line), null)
  assert.deepEqual(exactDiagnosticLine(source, 2), { from: 4, to: 5, line: 2, column: 1, endLine: 2, endColumn: 2, precision: 'line' })
  for (const [from, to] of [[-1, 1], [0, 50], [5, 4], [0.5, 2], [1, 2], [2, 3]]) assert.equal(exactSourceRange(source, from, to), null)
  assert.equal(sourceRangeToEditor(source, { from: 1, to: 2 }, '\r\n'), null)
  assert.equal(sourceRangeToEditor(source, { from: 0, to: 2 }, 'unsupported'), null)
  const input = project(source)
  const diagnostics: LatexDiagnostic[] = [{ severity: 'error', file: 'main.tex', line: 0, message: 'No exact line' }, { severity: 'error', file: 'missing.tex', line: 1, message: 'No project path' }]
  const wrapped = compilerEditorDiagnostics(input, diagnostics, 'browser')
  assert.ok(wrapped.every((item) => item.range === null && item.fileId === null && item.path === null))
  assert.deepEqual(wrapped.map((item) => item.diagnostic), diagnostics)
  assert.ok(!Object.hasOwn(diagnostics[0], 'origin'), 'Strict compiler DTOs are not expanded')
})

test('one merge retains hover provenance, refuses same-rN forks and never promotes local hints to errors', () => {
  const source = project('{', { 'part.tex': 'keep' }), report = checkLocalDiagnostics(source, 'f-0')!
  const compiler = compilerEditorDiagnostics(source, [{ severity: 'error', file: 'main.tex', line: 1, message: 'Compiler issue', help: 'Original evidence' }], 'browser')
  const merged = mergedEditorDiagnostics(source, 'f-0', 'browser', compiler, report, '\n')
  assert.deepEqual(merged.map((item) => item.source), ['Compiler', 'Local check'])
  assert.deepEqual(merged.map((item) => item.severity), ['error', 'warning'])
  assert.deepEqual(merged.map((item) => item.markClass), ['cm-latex-compiler', 'cm-latex-local-check'])
  assert.equal(merged[0].message, 'Compiler issue\nOriginal evidence')
  assert.ok(Object.isFrozen(report.snapshot.files[0]))
  source.files[1].content = 'same-rN fork'
  assert.equal(report.snapshot.files[1].content, 'keep')
  assert.deepEqual(mergedEditorDiagnostics(source, 'f-0', 'browser', compiler, report, '\n'), [])
  assert.deepEqual(mergedEditorDiagnostics(report.snapshot, 'f-0', 'native', compiler, report, '\n'), [])
  assert.deepEqual(mergedEditorDiagnostics(report.snapshot, 'f-1', 'browser', compiler, report, '\n'), [])
})

test('the actual CodeMirror publisher clears on the edit transaction, rejects stale refresh, and preserves refused-edit marks', () => {
  const source = 'bad\r\nkept', diagnostics = [{ from: 0, to: 3, severity: 'error' as const, source: 'Compiler', message: 'Original problem' }]
  let state = EditorState.create({ doc: source, extensions: [EditorState.lineSeparator.of('\r\n'), editorDiagnosticsExtension] })
  const refresh = refreshEditorDiagnostics.of({ source, diagnostics })
  state = state.update({ effects: refresh }).state
  assert.equal(diagnosticCount(state), 1)
  const transaction = state.update({ changes: { from: 0, to: 3, insert: 'fixed' }, effects: refresh })
  assert.equal(diagnosticCount(transaction.state), 0, 'A same-transaction old refresh cannot beat source invalidation')
  state = transaction.state.update({ effects: refresh }).state
  assert.equal(diagnosticCount(state), 0, 'A late refresh of old props cannot repaint the new source')
  const newMarks = [{ ...diagnostics[0], to: 5 }]
  state = state.update({ effects: refreshEditorDiagnostics.of({ source: state.sliceDoc(), diagnostics: newMarks }) }).state
  assert.equal(diagnosticCount(state), 1)
  let observed = ''
  forEachDiagnostic(state, (diagnostic) => { observed = diagnostic.source! })
  assert.equal(observed, 'Compiler')
  let refused = EditorState.create({ doc: source, extensions: [EditorState.lineSeparator.of('\r\n'), editorDiagnosticsExtension, EditorState.transactionFilter.of((transaction) => transaction.docChanged ? [] : transaction)] })
  refused = refused.update({ effects: refresh }).state
  refused = refused.update({ changes: { from: 0, insert: 'refused' } }).state
  assert.equal(refused.sliceDoc(), source)
  assert.equal(diagnosticCount(refused), 1)
})

test('undefined control sequence needs explicit authority plus one literal token at the validated source line', () => {
  const input = project('\u0995\ud83d\ude00 \\sectoin{Heading}')
  const diagnostic: LatexDiagnostic = { severity: 'error', file: 'main.tex', line: 1, message: 'Undefined control sequence.', help: 'Undefined control sequence: \\sectoin' }
  const issue = compilerEditorDiagnostics(input, [diagnostic], 'browser')[0]
  const found = undefinedControlSequence(issue)!
  assert.equal(found.command, '\\sectoin')
  assert.equal(input.files[0].content.slice(found.range.from, found.range.to), '\\sectoin')
  assert.equal(undefinedControlSequence({ ...issue, diagnostic: { ...diagnostic, help: undefined } }), null)
  assert.equal(undefinedControlSequence({ ...issue, origin: 'local' }), null)
  for (const source of ['% \\sectoin', '\\verb|\\sectoin|', '\\newcommand{\\sectoin}{A}', '\\sectoin{} \\sectoin{}']) {
    assert.equal(undefinedControlSequence(compilerEditorDiagnostics(project(source), [diagnostic], 'browser')[0]), null, source)
  }
  const unhelped = compilerEditorDiagnostics(input, [{ ...diagnostic, help: undefined }], 'browser')[0]
  assert.equal(undefinedControlSequence(unhelped, '/job/./main.tex:1: Undefined control sequence.\nl.1 ... \\sectoin\n {Heading}')?.command, '\\sectoin')
  assert.equal(undefinedControlSequence(unhelped, '/job/vendor.sty:1: Undefined control sequence.\nl.1 ... \\sectoin'), null)
  assert.equal(undefinedControlSequence(unhelped, '! Undefined control sequence.\nl.1 ... \\sectoin'), null, 'An unbound log line is not file evidence')
  assert.equal(undefinedControlSequence(unhelped, '/job/main.tex:1: Undefined control sequence.\n\\sectoin #1->\\missing\nl.1 ... \\sectoin'), null, 'Macro expansion context is not an exact undefined source token')
  assert.equal(undefinedControlSequence(issue, '/job/main.tex:1: Undefined control sequence.\n<argument> \\missing\nl.1 ... \\sectoin'), null, 'Contrary expansion evidence also defeats a named help string')
  assert.equal(undefinedControlSequence({ ...issue, diagnostic: { ...diagnostic, help: 'The compiler stopped at \\sectoin.' } })?.command, '\\sectoin')
})

test('CodeMirror binds both diagnostic directions and does not install a competing automatic lint writer', () => {
  const source = readFileSync(new URL('./CodeMirrorSource.tsx', import.meta.url), 'utf8')
  assert.match(source, /key: 'F8', run: nextDiagnostic/u)
  assert.match(source, /key: 'Shift-F8', run: previousDiagnostic/u)
  assert.match(source, /compositionstart/u)
  assert.match(source, /compositionend/u)
  assert.match(source, /document\.visibilityState/u)
  assert.match(source, /value\.diagnosticRuntime === runtime/u)
  assert.doesNotMatch(source, /\bsetDiagnostics\(|\blinter\(/u)
})
