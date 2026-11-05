import { EditorState, Transaction, type Transaction as EditorTransaction } from '@codemirror/state'
import { isolateHistory } from '@codemirror/commands'
import { captureEditorSnapshot, checkLocalDiagnostics, exactDiagnosticLine, exactSourceRange, inspectLatexSource, literalEnvironmentMismatches, sourceLines, sourceRangeToEditor, undefinedControlSequence, type EditorDiagnostic } from './editorDiagnostics.ts'
import { isWellFormedText, LatexProjectError, utf8Bytes, validateLatexProject } from './project.ts'
import { assessLatexProject } from './projectAssessment.ts'
import { matchesSourceSnapshot } from './workspaceIdentity.ts'
import type { PackageAssistance } from './packageAssistance.ts'
import type { LatexProject, LatexRuntime } from './types.ts'

export type SourceFixHunk = Readonly<{ from: number; to: number; expectedText: string; replacement: string }>
export type ReviewedSourceFix = Readonly<{
  snapshot: LatexProject; runtime: LatexRuntime; fileId: string; path: string; kind: 'known-command-typo' | 'environment-end' | 'package-declaration'
  title: string; explanation: string; before: string; after: string; previewFrom: number; previewTo: number; hunks: readonly SourceFixHunk[]
}>
type FixDescription = Pick<ReviewedSourceFix, 'kind' | 'runtime' | 'title' | 'explanation'>
const knownTypos: Readonly<Record<string, string>> = Object.freeze({ '\\sectoin': '\\section', '\\secion': '\\section', '\\subsectoin': '\\subsection',
  '\\textfb': '\\textbf', '\\textib': '\\textit', '\\documetclass': '\\documentclass', '\\documentcalss': '\\documentclass', '\\usepackge': '\\usepackage',
  '\\inclduegraphics': '\\includegraphics', '\\includegrapics': '\\includegraphics', '\\begn': '\\begin', '\\itme': '\\item' })
const knownEnvironments = new Set(['itemize', 'enumerate', 'description', 'center', 'flushleft', 'flushright', 'quote', 'quotation', 'tabular', 'tabular*', 'minipage', 'multicols'])
const MAX_FIX_UNITS = 4096

function patchedSource(source: string, hunks: readonly SourceFixHunk[]) {
  let after = '', from = 0
  for (const hunk of hunks) { after += source.slice(from, hunk.from) + hunk.replacement; from = hunk.to }
  return after + source.slice(from)
}

/** Freeze exactly what the user reviews. No source, history, storage or compiler mutation happens here. */
export function reviewSourceFix(project: LatexProject, fileId: string, hunks: readonly SourceFixHunk[], description: FixDescription): ReviewedSourceFix {
  validateLatexProject(project)
  const file = project.files.find((item) => item.id === fileId)
  if (!file || !/\.(?:tex|sty|cls)$/iu.test(file.path)) throw new LatexProjectError('A reviewed fix must target one existing TeX source file.')
  if (!Array.isArray(hunks) || !hunks.length || hunks.length > 8 || !['known-command-typo', 'environment-end', 'package-declaration'].includes(description.kind)
    || !['browser', 'native'].includes(description.runtime) || typeof description.title !== 'string' || !description.title || description.title.length > 200
    || typeof description.explanation !== 'string' || description.explanation.length > 2048) throw new LatexProjectError('The source fix review is invalid or exceeds its bound.')
  let previousTo = -1, previousFrom = -1, units = 0
  for (const hunk of hunks) {
    if (!hunk || !exactSourceRange(file.content, hunk.from, hunk.to) || hunk.from < previousTo || hunk.from === previousFrom
      || typeof hunk.expectedText !== 'string' || typeof hunk.replacement !== 'string' || !isWellFormedText(hunk.replacement)
      || file.content.slice(hunk.from, hunk.to) !== hunk.expectedText || hunk.expectedText === hunk.replacement) throw new LatexProjectError('A fix hunk has invalid bounds, overlaps, or does not match its exact expected source text.')
    previousFrom = hunk.from; previousTo = hunk.to
    units += hunk.expectedText.length + hunk.replacement.length
    if (units > MAX_FIX_UNITS || utf8Bytes(hunk.replacement) > MAX_FIX_UNITS) throw new LatexProjectError('The source fix exceeds the small reviewed-patch budget.')
  }
  const first = hunks[0].from, last = hunks.at(-1)!.to
  if (last - first > MAX_FIX_UNITS) throw new LatexProjectError('The fix spans too much source for a small review.')
  const lines = sourceLines(file.content), firstLine = lines.find((line) => first >= line.from && first <= line.to), lastLine = lines.find((line) => last >= line.from && last <= line.to)
  const wholeLines = firstLine && lastLine && lastLine.to - firstLine.from <= MAX_FIX_UNITS
  const previewFrom = wholeLines ? firstLine.from : first, previewTo = wholeLines ? lastLine.to : last
  const before = file.content.slice(previewFrom, previewTo)
  const after = patchedSource(before, hunks.map((hunk) => ({ ...hunk, from: hunk.from - previewFrom, to: hunk.to - previewFrom })))
  const next = patchedSource(file.content, hunks)
  validateLatexProject({ ...project, files: project.files.map((item) => item.id === fileId ? { ...item, content: next } : item) })
  return Object.freeze({ ...description, snapshot: captureEditorSnapshot(project), fileId, path: file.path, before, after, previewFrom, previewTo,
    hunks: Object.freeze(hunks.map((hunk) => Object.freeze({ ...hunk }))) })
}

export function reviewDiagnosticFix(project: LatexProject, issue: EditorDiagnostic, compilerLog = ''): ReviewedSourceFix | null {
  if (!matchesSourceSnapshot(project, issue.snapshot)) return null
  const file = project.files.find((item) => item.id === issue.fileId && item.path === issue.path)
  if (!file || !issue.range) return null
  const control = undefinedControlSequence(issue, compilerLog)
  if (control && Object.hasOwn(knownTypos, control.command)) {
    const assessment = assessLatexProject(project)
    if (!assessment.reachablePaths.includes(file.path) || assessment.truncated
      || assessment.references.some((reference) => reference.kind === 'source' && (reference.context !== 'direct' || !reference.projectPaths.length || reference.projectPaths.length > 1))
      || assessment.reachablePaths.some((path) => { const scan = inspectLatexSource(project.files.find((item) => item.path === path)!.content); return !scan.bounded || scan.undetermined.length > 0 })) return null
    const replacement = knownTypos[control.command]
    return reviewSourceFix(project, file.id, [{ from: control.range.from, to: control.range.to, expectedText: control.command, replacement }], {
      kind: 'known-command-typo', runtime: issue.runtime, title: `Replace ${control.command} with ${replacement}`,
      explanation: 'The compiler named this undefined control sequence at one exact literal source occurrence. This is a curated spelling suggestion, not a guarantee that the next compile will succeed.',
    })
  }
  const mismatch = literalEnvironmentMismatches(inspectLatexSource(file.content)).find(({ end }) => issue.range!.precision === 'token'
    ? end.nameFrom === issue.range!.from && end.nameTo === issue.range!.to : exactDiagnosticLine(file.content, issue.diagnostic.line)?.line === exactSourceRange(file.content, end.from, end.to)?.line)
  if (!mismatch || mismatch.crossesOuterEnvironment || !knownEnvironments.has(mismatch.begin.name) || mismatch.end.name === 'document') return null
  if (issue.origin === 'local') {
    const fresh = checkLocalDiagnostics(project, file.id, issue.runtime)
    if (issue.diagnostic.code !== 'local_environment_mismatch' || !fresh?.hints.some((hint) => hint.id === issue.id && hint.diagnostic.message === issue.diagnostic.message)) return null
  } else {
    const evidence = /\\begin\{([^{}]+)\}\s+on input line\s+(\d+)\s+ended by\s+\\end\{([^{}]+)\}/u.exec(`${issue.diagnostic.message}\n${issue.diagnostic.help ?? ''}`)
    if (issue.diagnostic.severity !== 'error' || !evidence || evidence[1] !== mismatch.begin.name || evidence[3] !== mismatch.end.name
      || exactSourceRange(file.content, mismatch.begin.from, mismatch.begin.to)?.line !== Number(evidence[2])) return null
  }
  return reviewSourceFix(project, file.id, [{ from: mismatch.end.nameFrom, to: mismatch.end.nameTo, expectedText: mismatch.end.name, replacement: mismatch.begin.name }], {
    kind: 'environment-end', runtime: issue.runtime, title: `Close the literal ${mismatch.begin.name} environment`,
    explanation: `This small proposal makes \\end{${mismatch.end.name}} match the preceding literal \\begin{${mismatch.begin.name}} in this file. Review the intended environment; no macro expansion or compile success is claimed.`,
  })
}

export function reviewPackageDeclaration(project: LatexProject, assistance: PackageAssistance): ReviewedSourceFix | null {
  if (assistance.kind !== 'declaration' || !assistance.declaration || !matchesSourceSnapshot(project, assistance.snapshot)) return null
  const { fileId, path, ...hunk } = assistance.declaration
  if (!project.files.some((file) => file.id === fileId && file.path === path)) return null
  return reviewSourceFix(project, fileId, [hunk], { kind: 'package-declaration', runtime: assistance.runtime, title: assistance.title, explanation: assistance.message })
}

/** Prepare one filtered, history-isolated transaction. The caller dispatches it once and never auto-compiles. */
export function reviewedSourceFixTransaction(state: EditorState, project: LatexProject, fileId: string, runtime: LatexRuntime, review: ReviewedSourceFix, validateChange: (fileId: string, text: string) => string | null): EditorTransaction {
  if (state.readOnly || runtime !== review.runtime || fileId !== review.fileId || !matchesSourceSnapshot(project, review.snapshot)) throw new LatexProjectError('The project, runtime or source changed after review. Review the current source again; nothing was applied.')
  const file = project.files.find((item) => item.id === fileId && item.path === review.path), source = state.sliceDoc()
  if (!file || source !== file.content || source !== review.snapshot.files.find((item) => item.id === fileId && item.path === review.path)?.content) throw new LatexProjectError('The editor no longer contains the exact reviewed source. Nothing was applied.')
  const checked = reviewSourceFix(project, fileId, review.hunks, review)
  if (checked.before !== review.before || checked.after !== review.after || checked.previewFrom !== review.previewFrom || checked.previewTo !== review.previewTo) throw new LatexProjectError('The before/after review was altered. Nothing was applied.')
  const next = patchedSource(source, checked.hunks), error = validateChange(fileId, next)
  if (error) throw new LatexProjectError(error)
  const changes = checked.hunks.map((hunk) => {
    const range = sourceRangeToEditor(source, hunk, state.lineBreak)
    if (!range || state.sliceDoc(range.from, range.to) !== hunk.expectedText) throw new LatexProjectError('The editor range no longer matches the exact reviewed text.')
    return { ...range, insert: state.toText(hunk.replacement) }
  })
  const transaction = state.update({ changes, annotations: [Transaction.userEvent.of('input.reviewed-fix'), isolateHistory.of('full')] })
  if (!transaction.docChanged || transaction.state.sliceDoc() !== next) throw new LatexProjectError('The editor refused the reviewed source change. Nothing was applied.')
  return transaction
}
