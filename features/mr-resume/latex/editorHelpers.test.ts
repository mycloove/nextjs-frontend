import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { snippetCompletion } from '@codemirror/autocomplete'
import { history, redo, undo } from '@codemirror/commands'
import { applyReviewedProjectReplace, editorSourceRange, environmentFold, findProjectLiteral, latexCommandPrefix, latexSnippets, PROJECT_SEARCH_LIMIT, projectLatexSnippets, projectLatexSuggestions, reviewProjectReplace, sourceLineSeparator } from './editorHelpers.ts'
import { makeCheckpoint, validateLatexProject } from './project.ts'
import { createTemplateProject } from './templates.ts'
import { LATEX_LIMITS, type LatexProject } from './types.ts'

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

test('compile shortcut takes precedence over the default blank-line editing command', () => {
  const source = readFileSync(new URL('./CodeMirrorSource.tsx', import.meta.url), 'utf8')
  const compile = source.indexOf("{ key: 'Mod-Enter', run:")
  assert.ok(compile > 0 && compile < source.indexOf('...defaultKeymap'))
})

function fixture(contents: Record<string, string>): LatexProject {
  return validateLatexProject({ ...createTemplateProject(), files: Object.entries(contents).map(([path, content], index) => ({ id: `file-${index}`, path, content })) })
}

test('project literal search reports raw ranges and CRLF/BOM-aware positions across sources and notes', () => {
  const project = fixture({ 'main.tex': '\ufeffName\r\nCV a.*$ CV\r\n\u0995\u09cd\u200d\u09b7 CV', 'notes.txt': 'CV\rLast CV', 'references.bib': '@article{CV,title={CV}}' })
  const before = project.files.map((file) => file.content)
  const result = findProjectLiteral(project, 'CV')
  assert.equal(result.matches.length, 7)
  assert.equal(result.truncated, false)
  assert.deepEqual(result.matches.slice(0, 2).map(({ file, line, column, endLine, endColumn, from, to }) => ({ file, line, column, endLine, endColumn, from, to })), [
    { file: 'main.tex', line: 2, column: 1, endLine: 2, endColumn: 3, from: 7, to: 9 },
    { file: 'main.tex', line: 2, column: 9, endLine: 2, endColumn: 11, from: 15, to: 17 },
  ])
  for (const match of result.matches) assert.equal(project.files.find((file) => file.id === match.fileId)!.content.slice(match.from, match.to), 'CV')
  assert.equal(findProjectLiteral(project, 'a.*$').matches.length, 1, 'Regex metacharacters stay literal')
  assert.equal(findProjectLiteral(project, 'cv').matches.length, 0, 'Case is not folded')
  const multiline = findProjectLiteral(project, 'CV\r\n\u0995').matches[0]
  assert.deepEqual([multiline.line, multiline.column, multiline.endLine, multiline.endColumn], [2, 9, 3, 2])
  assert.deepEqual(project.files.map((file) => file.content), before)
})

test('project search and review stay bounded without presenting a capped result as all occurrences', () => {
  const project = fixture({ 'main.tex': 'x'.repeat(1000) })
  assert.equal(findProjectLiteral(project, 'x').matches.length, 200)
  assert.equal(findProjectLiteral(project, 'x', 100000).matches.length, PROJECT_SEARCH_LIMIT)
  assert.equal(findProjectLiteral(project, 'x', 2).truncated, true)
  assert.equal(findProjectLiteral(fixture({ 'main.tex': 'xx' }), 'x', 2).truncated, false)
  assert.equal(findProjectLiteral(project, '').truncated, false)
  assert.ok(findProjectLiteral(project, 'x'.repeat(257)).reason)
  assert.ok(findProjectLiteral(project, '\ud800').reason)
  assert.ok(findProjectLiteral({ ...project, files: [{ ...project.files[0], content: 'x'.repeat(LATEX_LIMITS.sourceBytes + 1) }] }, 'x').reason)
  assert.throws(() => reviewProjectReplace(project, 'x', 'y'), /Narrow the search/u)
  assert.throws(() => reviewProjectReplace(fixture({ 'main.tex': 'xx' }), 'x', 'y'.repeat(LATEX_LIMITS.sourceBytes)), /budget/u)
  assert.ok(findProjectLiteral(fixture({ 'main.tex': 'a'.repeat(10000) + 'needle' }), 'needle').matches[0].preview.length <= 186)
})

test('search ranges select exact CodeMirror text with LF/CRLF/CR and mixed CR endings without source normalization', () => {
  for (const source of ['\ufeffA\nB\nmatch end', '\ufeffA\r\nB\r\nmatch end', '\ufeffA\rB\rmatch end', '\ufeffA\rB\nmatch end', '\ufeffA\r\nB\nmatch end']) {
    const project = fixture({ 'main.tex': source }), match = findProjectLiteral(project, 'match').matches[0]
    const state = EditorState.create({ doc: source, extensions: [EditorState.lineSeparator.of(sourceLineSeparator(source))] })
    const range = editorSourceRange(state.sliceDoc(), match, state.lineBreak)
    assert.equal(state.sliceDoc(range.from, range.to), 'match')
    const selected = state.update({ selection: EditorSelection.range(range.from, range.to) }).state
    assert.equal(selected.sliceDoc(), source)
  }
})

test('reviewed replacement is a single checkpointed revision and preserves untouched BOM, line breaks, paths and assets', () => {
  const project = fixture({ 'main.tex': '\ufeffCV\r\nCV\nKeep\r', 'notes.txt': 'CV notes', 'style.sty': '% untouched\r\n' })
  project.assets.push({ id: 'photo', path: 'CV.jpg', mediaType: 'image/jpeg', blob: new Blob(['photo'], { type: 'image/jpeg' }) })
  const before = project.files.map((file) => file.content), review = reviewProjectReplace(project, 'CV', '$& \\CV')
  assert.notEqual(review.snapshot, project)
  assert.ok(Object.isFrozen(review) && Object.isFrozen(review.snapshot.files[0]))
  assert.equal(review.changes.length, 2)
  assert.equal(review.matches.length, 3)
  const checkpoint = makeCheckpoint(project, 'Before reviewed replacement')
  const next = applyReviewedProjectReplace(project, review, checkpoint)
  assert.equal(next.revision, project.revision + 1)
  assert.equal(next.files[0].content, '\ufeff$& \\CV\r\n$& \\CV\nKeep\r')
  assert.equal(next.files[1].content, '$& \\CV notes')
  assert.equal(next.files[2], project.files[2])
  assert.equal(next.assets[0].blob, project.assets[0].blob)
  assert.equal(next.assets[0].path, 'CV.jpg')
  assert.deepEqual(project.files.map((file) => file.content), before)
  assert.deepEqual(checkpoint.project.files.map((file) => file.content), before)
})

test('replacement refuses same-revision forks, settings changes, stale checkpoints and altered reviews', () => {
  const project = fixture({ 'main.tex': 'CV', 'notes.txt': 'keep' }), review = reviewProjectReplace(project, 'CV', 'Resume'), checkpoint = makeCheckpoint(project, 'Before')
  for (const other of [
    { ...project, revision: project.revision + 1 }, { ...project, title: 'Changed' }, { ...project, engine: 'pdflatex' as const },
    { ...project, files: project.files.map((file) => file.path === 'notes.txt' ? { ...file, content: 'fork' } : file) },
    { ...project, id: 'different' },
  ]) assert.throws(() => applyReviewedProjectReplace(other, review, checkpoint), /changed/u)
  assert.throws(() => applyReviewedProjectReplace(project, review, { ...checkpoint, project: { ...project, revision: 50 } }), /checkpoint/u)
  assert.throws(() => applyReviewedProjectReplace(project, { ...review, changes: [{ ...review.changes[0], after: 'unreviewed' }] }, checkpoint), /altered/u)
  assert.equal(Reflect.set(review.snapshot.files[0], 'content', 'mutated'), false)
  assert.equal(applyReviewedProjectReplace(project, reviewProjectReplace(project, 'CV', 'CV'), checkpoint), project)
})

test('reference suggestions find project labels, ignore comment/verbatim declarations and replace only the key token', () => {
  const project = fixture({ 'main.tex': '\\label{cv:first}\n', 'sections/work.tex': '% \\label{cv:comment}\r\n\\label{cv:work}\r\n\\begin{verbatim}\n\\label{cv:hidden}\n\\end{verbatim}' })
  const file = project.files[0], source = file.content + '\\cref{cv:first, cv:woZZ}'
  const position = source.indexOf('ZZ'), result = projectLatexSuggestions(project, file, source, position)!
  assert.deepEqual(result.options.map((item) => item.label), ['cv:work'])
  assert.equal(source.slice(result.from, result.to), 'cv:woZZ')
  assert.match(result.options[0].detail, /sections\/work.tex:2/u)
  for (const hidden of ['% \\ref{cv:', '\\begin{verbatim}\n\\ref{cv:', '\\verb|\\ref{cv:']) assert.equal(projectLatexSuggestions(project, file, hidden, hidden.length), null)
  assert.equal(projectLatexSuggestions(project, file, '\\label{cv:', 10), null, 'Existing labels are not offered as duplicate definitions')
})

test('citation suggestions support biblatex/natbib options, real bibitems and bounded literal bib keys only', () => {
  const project = fixture({ 'main.tex': '\\bibitem[Demo]{manual}\n', 'refs.bib': '% @book{hidden,}\n@comment{ @article{commented,} }\n@string{name="Demo"}\n@article{alpha, title={Literal @book{nested,} text}}\n@book(beta, title="Title ) text")\n@misc{gamma, title={Unicode \u0995\u09cd\u200d\u09b7}}' })
  const file = project.files[0], source = file.content + '\\parencite[see][p. 4]{'
  const result = projectLatexSuggestions(project, file, source, source.length)!
  assert.deepEqual(result.options.map((item) => item.label), ['manual', 'alpha', 'beta', 'gamma'])
  const multiple = '\\citep{alpha, be'
  const second = projectLatexSuggestions(project, file, multiple, multiple.length)!
  assert.deepEqual(second.options.map((item) => item.label), ['beta'])
  assert.equal(multiple.slice(second.from), 'be')
  assert.equal(projectLatexSuggestions(project, file, '\\cite{\\macro', 12), null)
})

test('path suggestions use literal project filenames with command-specific extensions and no rewrites', () => {
  const project = fixture({ 'main.tex': '', 'sections/work.tex': '', 'refs/list.bib': '', 'resume.sty': '', 'plain.bst': '' })
  project.assets.push({ id: 'photo', path: 'images/photo.jpg', mediaType: 'image/jpeg', blob: new Blob(['photo']) })
  const file = project.files[0]
  const options = (prefix: string) => projectLatexSuggestions(project, file, prefix, prefix.length)?.options.map((item) => item.label)
  assert.deepEqual(options('\\input{sections/'), ['sections/work.tex'])
  assert.deepEqual(options('\\include{sections/'), ['sections/work'])
  assert.deepEqual(options('\\includegraphics[width=3cm]{'), ['images/photo.jpg'])
  assert.deepEqual(options('\\addbibresource{'), ['refs/list.bib'])
  assert.deepEqual(options('\\bibliography{'), ['refs/list'])
  assert.deepEqual(options('\\usepackage{'), ['resume'])
  assert.deepEqual(options('\\bibliographystyle{'), ['plain'])
  assert.equal(options('\\input{https://'), undefined)
  assert.equal(file.content, '')
})

test('bounded completion candidates can be requeried for a more specific key beyond the initial display cap', () => {
  const project = fixture({ 'main.tex': '', 'sections/labels.tex': Array.from({ length: 300 }, (_, index) => `\\label{key:${index}}`).join('\n') }), file = project.files[0]
  const prefix = '\\ref{key:', specific = '\\ref{key:299'
  assert.equal(projectLatexSuggestions(project, file, prefix, prefix.length)!.options.length, 256)
  assert.deepEqual(projectLatexSuggestions(project, file, specific, specific.length)!.options.map((item) => item.label), ['key:299'])
  const source = readFileSync(new URL('./CodeMirrorSource.tsx', import.meta.url), 'utf8')
  assert.match(source, /if \(argument\) return argument/u, 'Prefix-filtered results must not be cached with an unconditional validFor')
})

test('CV snippets require a reachable known macro signature, not a template name or an unused class', () => {
  const project = fixture({ 'main.tex': '\\documentclass{article}\n', 'resume.sty': '\\RequirePackage{hyperref}\n\\newcommand{\\resumeentry}[3]{#1 #2 #3}', 'unused.cls': '\\newcommand{\\cvevent}[4]{#1}' })
  const file = project.files[0], labels = (source = file.content) => projectLatexSnippets(project, file, source).map((item) => item.label)
  assert.ok(!labels().includes('\\resumeentry'))
  assert.ok(!labels().includes('\\href'))
  assert.ok(!labels().includes('\\cvevent'))
  assert.ok(labels('\\usepackage{resume}').includes('\\resumeentry'))
  assert.ok(labels('\\usepackage{resume}').includes('\\href'))
  project.files[1].content = '\\newcommand{\\resumeentry}[1]{#1}'
  assert.ok(!labels('\\usepackage{resume}').includes('\\resumeentry'))
  assert.ok(!labels('% \\newcommand{\\resumeentry}[3]{#1}').includes('\\resumeentry'))
  assert.ok(labels('\\newcommand{\\cvsection}[2][]{#2}').includes('\\cvsection'))
})

test('command context preserves UTF-16 positions after masked non-BMP text and ignores literal command examples', () => {
  const source = '\\begin{verbatim}\n\ud83d\ude00 \\ref{hidden}\n\\end{verbatim}\n\\sect'
  assert.deepEqual(latexCommandPrefix(source, source.length), { from: source.lastIndexOf('\\sect'), to: source.length })
  for (const example of ['% \\sec', '\\verb|\\sec', '\\verb|first| \\verb|\\sec', '\\begin{verbatim}\n\\sec']) assert.equal(latexCommandPrefix(example, example.length), null)
})

test('real CodeMirror snippet transactions keep CRLF/BOM and undo/redo and still obey transaction refusal', () => {
  const original = '\ufeffCV\r\n', snippet = latexSnippets.find((item) => item.label === '\\section*')!
  let state = EditorState.create({ doc: original, extensions: [EditorState.lineSeparator.of('\r\n'), history()] })
  const target = { get state() { return state }, dispatch(transaction: Transaction) { state = transaction.state } }
  const completion = snippetCompletion(snippet.template, { label: snippet.label })
  assert.equal(typeof completion.apply, 'function')
  if (typeof completion.apply !== 'function') return
  completion.apply(target as unknown as EditorView, completion, state.doc.length, state.doc.length)
  assert.equal(state.sliceDoc(), original + '\\section*{Heading}\r\nWriting')
  assert.equal(undo(target), true)
  assert.equal(state.sliceDoc(), original)
  assert.equal(redo(target), true)
  assert.equal(state.sliceDoc(), original + '\\section*{Heading}\r\nWriting')
  state = EditorState.create({ doc: original, extensions: [EditorState.lineSeparator.of('\r\n'), EditorState.transactionFilter.of((transaction) => transaction.docChanged ? [] : transaction)] })
  completion.apply(target as unknown as EditorView, completion, state.doc.length, state.doc.length)
  assert.equal(state.sliceDoc(), original)
})
