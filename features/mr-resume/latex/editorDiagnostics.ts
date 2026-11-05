import { EditorState, StateEffect } from '@codemirror/state'
import { linter, setDiagnosticsEffect, type Diagnostic } from '@codemirror/lint'
import { isWellFormedText } from './project.ts'
import { diagnosticSourceTarget, matchesSourceSnapshot } from './workspaceIdentity.ts'
import { LATEX_LIMITS, type LatexDiagnostic, type LatexProject, type LatexRuntime } from './types.ts'

/** Session metadata only. Raw UTF-16 offsets never enter the compiler/ZIP/storage DTOs. */
export type EditorSourceRange = Readonly<{ from: number; to: number; line: number; column: number; endLine: number; endColumn: number; precision: 'line' | 'token' }>
export type EditorDiagnostic = Readonly<{
  id: string; origin: 'compiler' | 'local'; snapshot: LatexProject; runtime: LatexRuntime
  fileId: string | null; path: string | null; range: EditorSourceRange | null; diagnostic: Readonly<LatexDiagnostic>
}>
export type LocalDiagnosticReport = Readonly<{
  snapshot: LatexProject; runtime: LatexRuntime; fileId: string; path: string; hints: readonly EditorDiagnostic[]
  status: 'checked' | 'undetermined' | 'skipped'; reason?: string
}>
export const LOCAL_CHECK_DELAY = 350
export const LOCAL_CHECK_MAX_UNITS = 128 * 1024
const MAX_HINTS = 40

export function captureEditorSnapshot(project: LatexProject): LatexProject {
  const snapshot = { ...project, files: project.files.map((file) => Object.freeze({ ...file })), assets: project.assets.map((asset) => Object.freeze({ ...asset })) }
  Object.freeze(snapshot.files); Object.freeze(snapshot.assets)
  return Object.freeze(snapshot)
}

export function sourceLines(source: string) {
  const lines: { from: number; to: number; breakTo: number }[] = []
  let from = 0
  for (const match of source.matchAll(/\r\n|\r|\n/gu)) {
    lines.push({ from, to: match.index!, breakTo: match.index! + match[0].length }); from = match.index! + match[0].length
  }
  lines.push({ from, to: source.length, breakTo: source.length })
  return lines
}

function sourceBoundary(source: string, offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length) return false
  const before = source.charCodeAt(offset - 1), after = source.charCodeAt(offset)
  return !(before === 13 && after === 10) && !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff)
}

export function exactSourceRange(source: string, from: number, to: number, precision: EditorSourceRange['precision'] = 'token'): EditorSourceRange | null {
  if (from > to || !sourceBoundary(source, from) || !sourceBoundary(source, to)) return null
  const lines = sourceLines(source)
  const position = (offset: number) => {
    let low = 0, high = lines.length
    while (low + 1 < high) { const middle = (low + high) >>> 1; if (lines[middle].from <= offset) low = middle; else high = middle }
    return { line: low + 1, column: offset - lines[low].from + 1 }
  }
  const start = position(from), end = position(to)
  return Object.freeze({ from, to, ...start, endLine: end.line, endColumn: end.column, precision })
}

/** Unlike editorSourceRange, this is an eligibility check: no line-one fallback or clamping. */
export function exactDiagnosticLine(source: string, line: number | undefined): EditorSourceRange | null {
  if (!Number.isSafeInteger(line) || line! < 1) return null
  const bounds = sourceLines(source)[line! - 1]
  return bounds ? exactSourceRange(source, bounds.from, bounds.to, 'line') : null
}

/** CodeMirror collapses ONLY its configured separator. Mixed endings retain their other raw units. */
export function sourceRangeToEditor(source: string, range: Pick<EditorSourceRange, 'from' | 'to'>, separator: string): { from: number; to: number } | null {
  if (!['\n', '\r', '\r\n'].includes(separator) || !exactSourceRange(source, range.from, range.to)) return null
  const offset = (raw: number) => separator.length === 1 ? raw : raw - (source.slice(0, raw).split(separator).length - 1)
  return { from: offset(range.from), to: offset(range.to) }
}

export type LiteralCommand = Readonly<{ name: string; from: number; to: number; depth: number }>
export type LiteralEnvironment = Readonly<{ name: string; from: number; to: number; nameFrom: number; nameTo: number; opening: boolean }>
export type LatexSourceInspection = {
  visible: string; commands: LiteralCommand[]; environments: LiteralEnvironment[]; undetermined: string[]
  incomplete: { from: number; to: number; message: string }[]; bounded: boolean
}
const macroCommands = new Set(['def', 'gdef', 'edef', 'xdef', 'let', 'futurelet', 'newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand',
  'NewDocumentCommand', 'RenewDocumentCommand', 'ProvideDocumentCommand', 'DeclareDocumentCommand', 'newenvironment', 'renewenvironment',
  'NewDocumentEnvironment', 'RenewDocumentEnvironment', 'DeclareDocumentEnvironment', 'newfontfamily', 'newfontface', 'newif',
  'DefineVerbatimEnvironment', 'RecustomVerbatimEnvironment', 'lstnewenvironment', 'newminted', 'NewEnviron', 'RenewEnviron'])
const syntaxCommands = new Set(['catcode', 'mathcode', 'lccode', 'uccode', 'scantokens', 'csname', 'endcsname', 'makeatletter', 'makeatother', 'ExplSyntaxOn', 'ExplSyntaxOff',
  'bgroup', 'egroup', 'begingroup', 'endgroup', 'obeylines', 'obeyspaces', 'expandafter', 'expanded', 'unexpanded', 'the', 'directlua', 'luaexec', 'latelua', 'setcatcodetable'])
const literalEnvironments = new Set(['verbatim', 'verbatim*', 'Verbatim', 'Verbatim*', 'BVerbatim', 'LVerbatim', 'lstlisting', 'minted', 'comment'])

export function literalArgument(source: string, from: number): { value: string; from: number; to: number; end: number } | null {
  const match = /^\s*\{([A-Za-z][A-Za-z0-9*_.\/-]{0,120})\}/u.exec(source.slice(from, from + 512))
  if (!match) return null
  const start = from + match[0].indexOf('{') + 1
  return { value: match[1], from: start, to: start + match[1].length, end: from + match[0].length }
}

/** A bounded lexical inspection, not TeX expansion. Masks preserve every UTF-16 unit and line break. */
export function inspectLatexSource(source: string): LatexSourceInspection {
  const result: LatexSourceInspection = { visible: '', commands: [], environments: [], undetermined: [], incomplete: [], bounded: true }
  if (source.length > LOCAL_CHECK_MAX_UNITS || !isWellFormedText(source) || (source.match(/\r\n|\r|\n/g)?.length ?? 0) >= 4096) {
    result.bounded = false; result.undetermined.push('This file exceeds the local check budget or is not complete Unicode text.'); return result
  }
  const masks: { from: number; to: number }[] = []
  const unknown = (reason: string) => { if (!result.undetermined.includes(reason)) result.undetermined.push(reason) }
  let depth = 0
  for (let at = 0; at < source.length;) {
    const char = source[at]
    if (char === '%') {
      const start = at
      while (at < source.length && !/[\r\n]/u.test(source[at])) at++
      masks.push({ from: start, to: at }); continue
    }
    if (char === '{') depth++
    else if (char === '}') depth = Math.max(0, depth - 1)
    if (char !== '\\') { at++; continue }
    const from = at++
    if (/[A-Za-z@]/u.test(source[at] ?? '')) while (/[A-Za-z@]/u.test(source[at] ?? '')) at++
    else if (at < source.length) at += String.fromCodePoint(source.codePointAt(at)!).length
    const name = source.slice(from + 1, at), token = { name, from, to: at, depth }
    if (name === 'verb' || name === 'Verb' || name === 'lstinline' || name === 'mintinline') {
      // Optional arguments for the package variants are deliberately not interpreted.
      if (name !== 'verb') { unknown('Inline verbatim package syntax is not determined.'); break }
      const start = source[at] === '*' ? at + 1 : at, delimiter = start < source.length ? String.fromCodePoint(source.codePointAt(start)!) : ''
      let end = start + delimiter.length
      if (delimiter && !/\s/u.test(delimiter)) while (end < source.length && !source.startsWith(delimiter, end) && !/[\r\n]/u.test(source[end])) end++
      if (!delimiter || /\s/u.test(delimiter) || !source.startsWith(delimiter, end)) {
        result.incomplete.push({ from, to: at, message: 'The literal \\verb delimiter is incomplete on this line.' })
        end = start
        while (end < source.length && !/[\r\n]/u.test(source[end])) end++
      } else end += delimiter.length
      masks.push({ from, to: end }); at = end; continue
    }
    if (name === 'begin' || name === 'end') {
      // A comment between a control sequence and its argument is ordinary TeX whitespace.
      let argumentAt = at
      while (argumentAt < source.length) {
        if (/\s/u.test(source[argumentAt])) argumentAt++
        else if (source[argumentAt] === '%') { while (argumentAt < source.length && !/[\r\n]/u.test(source[argumentAt])) argumentAt++ }
        else break
      }
      const argument = literalArgument(source, argumentAt)
      if (!argument) unknown('A literal environment name is incomplete or macro-dependent.')
      else if (name === 'begin' && literalEnvironments.has(argument.value)) {
        const closing = new RegExp(`(?:^|[\\r\\n])[\\t ]*\\\\end\\{${argument.value.replace(/\*/gu, '\\*')}\\}[\\t ]*(?=%|[\\r\\n]|$)`, 'u').exec(source.slice(argument.end))
        const end = closing ? argument.end + closing.index + closing[0].length : source.length
        masks.push({ from, to: end }); at = end
        if (!closing) unknown('A verbatim body has no standalone literal closing marker in this file.')
        continue
      } else result.environments.push({ name: argument.value, from, to: argument.end, nameFrom: argument.from, nameTo: argument.to, opening: name === 'begin' })
    }
    if (macroCommands.has(name)) unknown('Macro definitions can change grouping or command meaning; local structure is not determined.')
    if (syntaxCommands.has(name) || source.slice(from, at + 1).includes('^^')) unknown('TeX syntax or category-code changes are not determined by local checks.')
    if (/^(?:if|If)[A-Za-z@]*$/u.test(name) || ['else', 'fi', 'or', 'unless'].includes(name)) unknown('Conditional execution is not determined by local checks.')
    if (name === 'endinput') { masks.push({ from, to: source.length }); break }
    result.commands.push(token)
    if (!/^[A-Za-z@]+$/u.test(name)) masks.push({ from, to: at })
    if (result.commands.length > 8192) { result.bounded = false; unknown('This file exceeds the local command budget.'); break }
  }
  let from = 0
  result.visible = masks.map((mask) => { const part = source.slice(from, mask.from) + source.slice(mask.from, mask.to).replace(/[^\r\n]/g, ' '); from = mask.to; return part }).join('') + source.slice(from)
  if (result.visible.includes('^^')) unknown('TeX character-code notation is not determined by local checks.')
  return result
}

export function literalEnvironmentMismatches(inspection: LatexSourceInspection) {
  const stack: LiteralEnvironment[] = [], mismatches: { begin: LiteralEnvironment; end: LiteralEnvironment; crossesOuterEnvironment: boolean }[] = []
  if (!inspection.bounded || inspection.undetermined.length || inspection.commands.some((token) => ['input', 'include', 'subfile', 'import', 'subimport'].includes(token.name))) return mismatches
  for (const token of inspection.environments) {
    if (token.opening) stack.push(token)
    else if (stack.length) {
      const begin = stack.pop()!
      if (begin.name !== token.name) { mismatches.push({ begin, end: token, crossesOuterEnvironment: stack.some((outer) => outer.name === token.name) }); break }
    }
  }
  return mismatches
}

export function shouldCheckLocalSource(state: { active: boolean; visible: boolean; composing: boolean }) {
  return state.active && state.visible && !state.composing
}

export function checkLocalDiagnostics(project: LatexProject, fileId: string, runtime: LatexRuntime = 'browser', state = { active: true, visible: true, composing: false }): LocalDiagnosticReport | null {
  const file = project.files.find((item) => item.id === fileId)
  if (!file) return null
  const snapshot = captureEditorSnapshot(project), hints: EditorDiagnostic[] = []
  const report = (status: LocalDiagnosticReport['status'], reason?: string): LocalDiagnosticReport => Object.freeze({ snapshot, runtime, fileId, path: file.path, hints: Object.freeze(hints), status, ...(reason ? { reason } : {}) })
  if (!shouldCheckLocalSource(state) || !/\.(?:tex|sty|cls)$/iu.test(file.path)) return report('skipped')
  const scan = inspectLatexSource(file.content)
  if (!scan.bounded || scan.undetermined.length) return report('undetermined', scan.undetermined.join(' '))
  const hint = (from: number, to: number, code: string, message: string) => {
    const range = exactSourceRange(file.content, from, to)
    if (!range || hints.length >= MAX_HINTS) return
    hints.push(Object.freeze({ id: `local:${file.id}:${code}:${from}:${to}`, origin: 'local', snapshot, runtime, fileId, path: file.path, range,
      diagnostic: Object.freeze({ severity: 'warning', code, message, file: file.path, line: range.line, help: 'Local check only, not a compiler error. The real compiler decides whether this source is valid.' }) }))
  }
  for (const item of scan.incomplete) hint(item.from, item.to, 'local_incomplete_delimiter', item.message)
  // Includes can supply either half of a group. Do not claim a file boundary is a TeX boundary.
  if (scan.commands.some((token) => ['input', 'include', 'subfile', 'import', 'subimport'].includes(token.name))) return report('undetermined', 'Imported source may supply grouping or environment boundaries. Cross-file structure was not checked.')
  const completeFile = file.path === project.mainFile
  const braces: number[] = []
  for (let at = 0; at < scan.visible.length; at++) {
    if (scan.visible[at] === '{') braces.push(at)
    else if (scan.visible[at] === '}' && braces.pop() === undefined && completeFile) hint(at, at + 1, 'local_unmatched_close_brace', 'No matching literal opening brace was found in this file.')
  }
  if (completeFile) for (const from of braces.slice(-MAX_HINTS)) hint(from, from + 1, 'local_unmatched_open_brace', 'No matching literal closing brace was found in this file.')
  for (const { begin, end } of literalEnvironmentMismatches(scan)) hint(end.nameFrom, end.nameTo, 'local_environment_mismatch', `Literal \\end{${end.name}} does not match the preceding \\begin{${begin.name}}.`)
  const environments: LiteralEnvironment[] = []
  for (const token of scan.environments) {
    if (token.opening) environments.push(token)
    else if (!environments.length) { if (completeFile) hint(token.from, token.to, 'local_unmatched_environment', `No literal \\begin{${token.name}} was found in this file.`) }
    else environments.pop()
  }
  if (completeFile) for (const token of environments.slice(-MAX_HINTS)) hint(token.from, token.to, 'local_unmatched_environment', `No literal \\end{${token.name}} was found in this file.`)
  const delimiters: LiteralCommand[] = []
  for (const token of scan.commands) {
    if (token.name === '(' || token.name === '[') delimiters.push(token)
    else if (token.name === ')' || token.name === ']') {
      const start = delimiters.pop()
      if (start && (start.name === '(') !== (token.name === ')')) hint(token.from, token.to, 'local_incomplete_delimiter', `This literal math delimiter does not match \\${start.name}.`)
      else if (!start && completeFile) hint(token.from, token.to, 'local_incomplete_delimiter', 'No matching literal math opener was found in this file.')
    }
  }
  if (completeFile) for (const token of delimiters.slice(-MAX_HINTS)) hint(token.from, token.to, 'local_incomplete_delimiter', 'No matching literal math closer was found in this file.')
  hints.sort((a, b) => a.range!.from - b.range!.from)
  return report(completeFile ? 'checked' : 'undetermined', completeFile ? undefined : 'Fragment boundaries may be supplied by another file; only internal literal mismatches were checked.')
}

export function compilerEditorDiagnostics(project: LatexProject, diagnostics: readonly LatexDiagnostic[], runtime: LatexRuntime, mapSource = true): EditorDiagnostic[] {
  const snapshot = captureEditorSnapshot(project)
  return diagnostics.slice(0, 128).map((diagnostic, index) => {
    const target = mapSource ? diagnosticSourceTarget(snapshot, snapshot, diagnostic) : null, file = target && snapshot.files.find((item) => item.id === target.fileId)
    return Object.freeze({ id: `compiler:${index}:${JSON.stringify([diagnostic.file, diagnostic.line, diagnostic.code, diagnostic.message, diagnostic.help])}`, origin: 'compiler', snapshot, runtime,
      fileId: file ? file.id : null, path: file ? file.path : null, range: file ? exactDiagnosticLine(file.content, diagnostic.line) : null, diagnostic: Object.freeze({ ...diagnostic }) })
  })
}

/** Named compiler evidence plus one exact literal occurrence, never an unknown-command heuristic. */
export function undefinedControlSequence(issue: EditorDiagnostic, compilerLog = ''): { command: string; range: EditorSourceRange } | null {
  if (issue.origin !== 'compiler' || issue.diagnostic.severity !== 'error' || !/\bUndefined control sequence\b/iu.test(issue.diagnostic.message)) return null
  const file = issue.snapshot.files.find((item) => item.id === issue.fileId && item.path === issue.path && item.path === issue.diagnostic.file)
  const line = file && exactDiagnosticLine(file.content, issue.diagnostic.line)
  if (!file || !line) return null
  const names = new Set<string>()
  const evidence = `${issue.diagnostic.message}\n${issue.diagnostic.help ?? ''}`
  for (const match of evidence.matchAll(/(?:^|\n)\s*(?:Undefined control sequence\s*:|The compiler stopped at)\s*(\\[A-Za-z@]+)\.?\s*(?=\n|$)/giu)) names.add(match[1])
  if (compilerLog && compilerLog.length <= LATEX_LIMITS.logBytes) {
    const lines = compilerLog.split(/\r\n|\r|\n/u)
    for (let index = 0; index < lines.length; index++) {
      const header = /^(.*?):(\d+):\s*(?:!\s*)?Undefined control sequence\.?\s*$/iu.exec(lines[index])
      if (!header || Number(header[2]) !== issue.diagnostic.line) continue
      const path = header[1].replace(/^\/(?:job|work\/project)\//u, '').replace(/^(?:\.\/)+/u, '')
      if (path !== file.path) continue
      for (const context of lines.slice(index + 1, index + 9)) {
        if (/^(?:!|.*?:\d+:)/u.test(context)) break
        if (/->|^\s*<(?:argument|recently read|inserted text|to be read again|template)>/iu.test(context)) return null
        const match = /^l\.(\d+)\s+.*?(\\[A-Za-z@]+)\s*$/u.exec(context)
        if (match && Number(match[1]) === issue.diagnostic.line) { names.add(match[2]); break }
      }
    }
  }
  if (names.size !== 1) return null
  const command = [...names][0], inspection = inspectLatexSource(file.content)
  if (!inspection.bounded || inspection.undetermined.length) return null
  const tokens = inspection.commands.filter((token) => `\\${token.name}` === command && token.from >= line.from && token.to <= line.to)
  if (tokens.length !== 1) return null
  const range = exactSourceRange(file.content, tokens[0].from, tokens[0].to)
  return range ? { command, range } : null
}

export function mergedEditorDiagnostics(project: LatexProject, fileId: string, runtime: LatexRuntime, compiler: readonly EditorDiagnostic[], local: LocalDiagnosticReport | null, separator: string): Diagnostic[] {
  const file = project.files.find((item) => item.id === fileId)
  if (!file) return []
  const hints = local && local.fileId === fileId && local.runtime === runtime && matchesSourceSnapshot(project, local.snapshot) ? local.hints : []
  return [...compiler, ...hints].flatMap((issue) => {
    if (issue.fileId !== fileId || issue.path !== file.path || issue.runtime !== runtime || !matchesSourceSnapshot(project, issue.snapshot) || !issue.range) return []
    const range = sourceRangeToEditor(file.content, issue.range, separator)
    return range ? [{ ...range, severity: issue.origin === 'local' ? 'warning' as const : issue.diagnostic.severity,
      source: issue.origin === 'local' ? 'Local check' : 'Compiler', markClass: issue.origin === 'local' ? 'cm-latex-local-check' : 'cm-latex-compiler',
      message: issue.diagnostic.help ? `${issue.diagnostic.message}\n${issue.diagnostic.help}` : issue.diagnostic.message }] : []
  }).sort((a, b) => a.from - b.from || a.to - b.to)
}

export const refreshEditorDiagnostics = StateEffect.define<{ source: string; diagnostics: readonly Diagnostic[] }>()
/** The only lint publisher. Clearing belongs to the edit transaction, before React echoes old props. */
export const editorDiagnosticsExtension = [linter(null, { autoPanel: false }), EditorState.transactionExtender.of((transaction) => {
  const refresh = transaction.effects.filter((effect) => effect.is(refreshEditorDiagnostics)).at(-1)
  if (!transaction.docChanged && !refresh) return null
  const diagnostics = transaction.docChanged || refresh!.value.source !== transaction.startState.sliceDoc() ? [] : refresh!.value.diagnostics
  return { effects: setDiagnosticsEffect.of(diagnostics) }
})]
