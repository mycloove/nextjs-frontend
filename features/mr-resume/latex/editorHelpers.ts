import { isWellFormedText, LatexProjectError, reviseProject, sameProjectSource, validateLatexProject, withoutComments } from './project.ts'
import { LATEX_LIMITS, type LatexCheckpoint, type LatexProject, type LatexTextFile } from './types.ts'

/** CodeMirror can preserve a consistent CRLF/CR file without changing it to LF on every edit. */
export function sourceLineSeparator(source: string) {
  const breaks = source.match(/\r\n|\r|\n/gu)
  if (!breaks?.length) return '\n'
  return breaks.every((item) => item === breaks[0]) ? breaks[0] : '\n'
}

function stripComment(line: string) {
  return line.replace(/(?<!\\)(?:\\\\)*%.*/u, '')
}

export function environmentFold(source: string, lineNumber: number): { from: number; to: number; endLine: number } | null {
  const separator = sourceLineSeparator(source), lines = source.split(separator)
  if (lineNumber < 1 || lineNumber > lines.length) return null
  const start = stripComment(lines[lineNumber - 1]), begin = start.match(/\\begin\{([^{}]+)\}/u)
  if (!begin) return null
  let depth = 0, from = 0, offset = 0
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (index < lineNumber - 1) { offset += line.length + separator.length; continue }
    if (index === lineNumber - 1) from = offset + line.length
    for (const match of stripComment(line).matchAll(/\\(begin|end)\{([^{}]+)\}/gu)) if (match[2] === begin[1]) {
      if (match[1] === 'begin') depth++
      else if (--depth === 0) return index > lineNumber - 1 ? { from, to: offset, endLine: index + 1 } : null
    }
    offset += line.length + separator.length
  }
  return null
}

export type ProjectLiteralMatch = {
  fileId: string; file: string; from: number; to: number
  line: number; column: number; endLine: number; endColumn: number; preview: string
}
export type ProjectLiteralSearch = {
  projectId: string; revision: number; query: string; matches: ProjectLiteralMatch[]; truncated: boolean; reason: string | null
}
export const PROJECT_SEARCH_LIMIT = 500

function lineStarts(source: string) {
  const starts = [0]
  for (const match of source.matchAll(/\r\n|\r|\n/gu)) starts.push(match.index! + match[0].length)
  return starts
}

function sourcePosition(starts: readonly number[], offset: number) {
  let low = 0, high = starts.length
  while (low + 1 < high) { const middle = (low + high) >>> 1; if (starts[middle] <= offset) low = middle; else high = middle }
  return { line: low + 1, column: offset - starts[low] + 1 }
}

/** Source/TeX line numbers include lone CRs; a mixed-ending CodeMirror document may retain them inside a line. */
export function editorSourceRange(source: string, jump: { line: number; column?: number; endLine?: number; endColumn?: number }, separator = sourceLineSeparator(source)) {
  const starts = lineStarts(source)
  const offset = (line: number, column: number) => {
    const index = Number.isSafeInteger(line) ? Math.max(0, Math.min(starts.length - 1, line - 1)) : 0
    const start = starts[index], next = starts[index + 1] ?? source.length
    const end = next > start && source[next - 1] === '\n' ? next - (source[next - 2] === '\r' ? 2 : 1) : next > start && source[next - 1] === '\r' ? next - 1 : next
    const raw = start + (Number.isSafeInteger(column) ? Math.max(0, Math.min(end - start, column - 1)) : 0)
    return separator.length > 1 ? raw - (source.slice(0, raw).split(separator).length - 1) * (separator.length - 1) : raw
  }
  const from = offset(jump.line, jump.column ?? 1)
  return { from, to: jump.endColumn === undefined ? from : Math.max(from, offset(jump.endLine ?? jump.line, jump.endColumn)) }
}

/** Non-overlapping, case-sensitive literals. Offsets are raw UTF-16; line/columns are 1-based (end exclusive). */
export function findProjectLiteral(project: LatexProject, query: string, maxMatches = 200): ProjectLiteralSearch {
  const result: ProjectLiteralSearch = { projectId: project.id, revision: project.revision, query, matches: [], truncated: false, reason: null }
  if (!query) return result
  if (query.length > 256 || !isWellFormedText(query)) return { ...result, reason: 'Use a literal search term of at most 256 valid Unicode characters.' }
  // Valid projects already have a stricter UTF-8 budget. Bound even unvalidated callers before scanning.
  if (project.files.length > LATEX_LIMITS.files || project.files.reduce((sum, file) => sum + file.content.length, 0) > LATEX_LIMITS.sourceBytes) {
    return { ...result, truncated: true, reason: 'The project exceeds the bounded source search budget.' }
  }
  const limit = Number.isFinite(maxMatches) ? Math.max(1, Math.min(PROJECT_SEARCH_LIMIT, Math.floor(maxMatches))) : 200
  for (const file of project.files) {
    let offset = 0
    const starts = lineStarts(file.content)
    while (offset <= file.content.length - query.length) {
      const from = file.content.indexOf(query, offset)
      if (from < 0) break
      if (result.matches.length === limit) return { ...result, truncated: true }
      const to = from + query.length, start = sourcePosition(starts, from), end = sourcePosition(starts, to)
      const first = starts[start.line - 1], last = starts[start.line] ?? file.content.length
      const previewFrom = Math.max(first, from - 60), previewTo = Math.min(last, previewFrom + 180)
      result.matches.push({ fileId: file.id, file: file.path, from, to, ...start, endLine: end.line, endColumn: end.column,
        preview: `${previewFrom > first ? '...' : ''}${file.content.slice(previewFrom, previewTo).replace(/[\r\n]+$/u, '')}${previewTo < last ? '...' : ''}` })
      offset = to
    }
  }
  return result
}

export type ProjectReplaceReview = Readonly<{
  snapshot: LatexProject; query: string; replacement: string
  matches: readonly Readonly<ProjectLiteralMatch>[]
  changes: readonly Readonly<{ fileId: string; file: string; before: string; after: string; occurrences: number }>[]
}>

/** Capture the entire reviewed source, not just rN: two tabs can have different text at the same revision. */
export function reviewProjectReplace(project: LatexProject, query: string, replacement: string): ProjectReplaceReview {
  validateLatexProject(project)
  if (!query || !isWellFormedText(replacement) || replacement.length > LATEX_LIMITS.sourceBytes) throw new LatexProjectError('Use a nonempty literal search and a bounded, valid Unicode replacement.')
  const snapshot: LatexProject = { ...project, files: project.files.map((file) => ({ ...file })), assets: project.assets.map((asset) => ({ ...asset })) }
  const search = findProjectLiteral(snapshot, query, PROJECT_SEARCH_LIMIT)
  if (search.reason || search.truncated) throw new LatexProjectError(search.reason ?? `More than ${PROJECT_SEARCH_LIMIT} occurrences were found. Narrow the search before reviewing a replacement.`)
  const nextLength = snapshot.files.reduce((sum, file) => sum + file.content.length, 0) + search.matches.length * (replacement.length - query.length)
  if (nextLength > LATEX_LIMITS.sourceBytes) throw new LatexProjectError('The reviewed replacement would exceed the source budget. Nothing was replaced.')
  const changes = snapshot.files.flatMap((file) => {
    const matches = search.matches.filter((match) => match.fileId === file.id)
    if (!matches.length || query === replacement) return []
    let after = '', offset = 0
    for (const match of matches) { after += file.content.slice(offset, match.from) + replacement; offset = match.to }
    after += file.content.slice(offset)
    return [{ fileId: file.id, file: file.path, before: file.content, after, occurrences: matches.length }]
  })
  validateLatexProject({ ...snapshot, files: snapshot.files.map((file) => ({ ...file, content: changes.find((change) => change.fileId === file.id)?.after ?? file.content })) })
  for (const item of [...snapshot.files, ...snapshot.assets, ...search.matches, ...changes]) Object.freeze(item)
  Object.freeze(snapshot.files); Object.freeze(snapshot.assets); Object.freeze(snapshot)
  return Object.freeze({ snapshot, query, replacement, matches: Object.freeze(search.matches), changes: Object.freeze(changes) })
}

function sameReviewedSnapshot(left: LatexProject, right: LatexProject) {
  return left.id === right.id && left.version === right.version && left.revision === right.revision && left.title === right.title
    && left.templateId === right.templateId && left.templateVersion === right.templateVersion && left.createdAt === right.createdAt
    && left.updatedAt === right.updatedAt && sameProjectSource(left, right)
}

/** No IO: the caller must retain/commit this before-snapshot checkpoint before applying the returned revision. */
export function applyReviewedProjectReplace(project: LatexProject, review: ProjectReplaceReview, checkpoint: LatexCheckpoint): LatexProject {
  if (!sameReviewedSnapshot(project, review.snapshot)) throw new LatexProjectError('The project changed after the replacement review. Review the current source again; nothing was replaced.')
  if (!checkpoint?.id || !sameReviewedSnapshot(checkpoint.project, review.snapshot)) throw new LatexProjectError('A checkpoint of the exact reviewed source is required before replacing project text.')
  // Re-derive instead of trusting externally supplied after-text or stale ranges.
  const checked = reviewProjectReplace(project, review.query, review.replacement)
  if (JSON.stringify(checked.changes) !== JSON.stringify(review.changes) || JSON.stringify(checked.matches) !== JSON.stringify(review.matches)) throw new LatexProjectError('The replacement review was altered. Nothing was replaced.')
  if (!checked.changes.length) return project
  return reviseProject(project, { files: project.files.map((file) => {
    const change = checked.changes.find((item) => item.fileId === file.id)
    return change ? { ...file, content: change.after } : file
  }) })
}

export const latexSnippets = [
  { label: '\\section*', template: '\\section*{${1:Heading}}\n${2:Writing}', detail: 'Resume section' },
  { label: '\\subsection*', template: '\\subsection*{${1:Heading}}\n${2:Writing}', detail: 'Subsection' },
  { label: '\\textbf', template: '\\textbf{${1:text}}', detail: 'Bold text' },
  { label: '\\emph', template: '\\emph{${1:text}}', detail: 'Emphasis' },
  { label: '\\href', template: '\\href{${1:https://example.com}}{${2:Link text}}', detail: 'Link' },
  { label: '\\input', template: '\\input{${1:section.tex}}', detail: 'Include local source' },
  { label: '\\includegraphics', template: '\\includegraphics[width=${1:30mm}]{${2:profile-photo.jpg}}', detail: 'Local image (graphicx required)' },
  { label: '\\begin{itemize}', template: '\\begin{itemize}\n  \\item ${1:Achievement}\n\\end{itemize}', detail: 'Achievement list' },
  { label: '\\begin', template: '\\begin{${1:environment}}\n  ${2:content}\n\\end{${1:environment}}', detail: 'Paired environment' },
  { label: '\\label', template: '\\label{${1:sec:label}}', detail: 'Define a reference label' },
  { label: '\\ref', template: '\\ref{${1:sec:label}}', detail: 'Reference a project label' },
  { label: '\\cite', template: '\\cite{${1:bibliography-key}}', detail: 'Cite a bibliography entry' },
  { label: '\\addbibresource', template: '\\addbibresource{${1:references.bib}}', detail: 'Local bibliography (biblatex required)' },
  { label: '\\textenglish', template: '\\textenglish{${1:English writing}}', detail: 'English span (polyglossia required)' },
] as const

/** Masks are for suggestions only. No masked or normalized text is ever written back to a project. */
function literalSource(source: string) {
  return source.split(/(\r\n|\r|\n)/u).map((line) => {
    const visible = withoutComments(line)
    return visible + ' '.repeat(line.length - visible.length)
  }).join('').replace(/(?<!\\)\\begin\{(verbatim\*?|Verbatim|lstlisting|minted|comment)\}[\s\S]*?(?:\\end\{\1\}|$)/gu, (value) => value.replace(/[^\r\n]/g, ' '))
    .replace(/(?<!\\)\\verb\*?([^\sA-Za-z])(?:(?!\1)[^\r\n])*(?:\1|$)/gmu, (value) => ' '.repeat(value.length))
}

function contextFiles(project: LatexProject | null | undefined, file: LatexTextFile, source: string) {
  const files = (project?.files ?? [file]).map((item) => item.id === file.id ? { ...item, content: source } : item)
  return files.length <= LATEX_LIMITS.files && files.reduce((sum, item) => sum + item.content.length, 0) <= LATEX_LIMITS.sourceBytes ? files : []
}

type LatexSnippet = { label: string; template: string; detail: string }
/** CV macros are offered only with their known arity in literal, locally reachable definitions. */
export function projectLatexSnippets(project: LatexProject | null | undefined, file: LatexTextFile, source = file.content): readonly LatexSnippet[] {
  const files = contextFiles(project, file, source), visited = new Set<string>(), packages = new Set<string>(), declarations = new Set<string>(), conflicting = new Set<string>()
  const main = files.find((item) => item.path === project?.mainFile) ?? files.find((item) => item.id === file.id)
  const pending = main ? [main] : []
  const mainDirectory = main?.path.slice(0, main.path.lastIndexOf('/') + 1) ?? ''
  while (pending.length) {
    const item = pending.shift()!
    if (visited.has(item.path)) continue
    visited.add(item.path)
    const text = literalSource(item.content), directory = item.path.slice(0, item.path.lastIndexOf('/') + 1)
    for (const match of text.matchAll(/(?<!\\)\\(documentclass|LoadClass|usepackage|RequirePackage|input|include)\s*(?:\[[^\]]*\]\s*)?\{([^{}\\%#]+)\}/gu)) {
      const extension = /class|Class/u.test(match[1]) ? '.cls' : /package|Package/u.test(match[1]) ? '.sty' : '.tex'
      for (const name of match[2].split(',').map((part) => part.trim())) {
        if (!name || /\s/u.test(name)) continue
        if (extension === '.sty') packages.add(name.replace(/\.sty$/iu, ''))
        const path = name.endsWith(extension) ? name : name + extension
        const included = [path, mainDirectory + path, directory + path].map((candidate) => files.find((entry) => entry.path === candidate)).find(Boolean)
        if (included && !visited.has(included.path) && !pending.includes(included)) pending.push(included)
      }
    }
    for (const match of text.matchAll(/(?<!\\)\\(?:newcommand|renewcommand|providecommand)\*?\s*\{\\(resumeentry|cvevent|cvsection)\}\s*\[([1-4])\]\s*(\[[^\]]*\])?\s*\{/gu)) {
      if ((match[1] === 'resumeentry' && match[2] === '3' && !match[3]) || (match[1] === 'cvevent' && match[2] === '4' && !match[3])
        || (match[1] === 'cvsection' && ((match[2] === '1' && !match[3]) || (match[2] === '2' && match[3] !== undefined)))) declarations.add(match[1])
      else conflicting.add(match[1])
    }
  }
  for (const name of conflicting) declarations.delete(name)
  const requires: Record<string, string> = { '\\href': 'hyperref', '\\includegraphics': 'graphicx', '\\addbibresource': 'biblatex', '\\textenglish': 'polyglossia' }
  return [...latexSnippets.filter((item) => !requires[item.label] || packages.has(requires[item.label])),
    ...(declarations.has('resumeentry') ? [{ label: '\\resumeentry', template: '\\resumeentry{${1:Role, Organization}}{${2:Dates}}{${3:Location}}', detail: 'Local three-argument resume entry' }] : []),
    ...(declarations.has('cvevent') ? [{ label: '\\cvevent', template: '\\cvevent{${1:Role}}{${2:Organization}}{${3:Dates}}{${4:Location}}', detail: 'Local four-argument CV event' }] : []),
    ...(declarations.has('cvsection') ? [{ label: '\\cvsection', template: '\\cvsection{${1:Heading}}', detail: 'Local CV section' }] : [])]
}

export type LatexArgumentSuggestions = { from: number; to: number; options: { label: string; detail: string; type: 'constant' | 'text' }[] }

export function latexCommandPrefix(source: string, position: number) {
  if (!Number.isSafeInteger(position) || position < 0 || position > source.length || source.length > LATEX_LIMITS.sourceBytes) return null
  const prefix = literalSource(source).slice(0, position).match(/(?<!\\)\\[A-Za-z]*$/u)
  if (!prefix) return null
  let to = position
  while (to < source.length && /[A-Za-z]/u.test(source[to])) to++
  return { from: prefix.index!, to }
}

/** Literal keys/paths only, not TeX expansion or a claim that a dependency is executed/available. */
export function projectLatexSuggestions(project: LatexProject | null | undefined, file: LatexTextFile, source: string, position: number): LatexArgumentSuggestions | null {
  if (!Number.isSafeInteger(position) || position < 0 || position > source.length || source.length > LATEX_LIMITS.sourceBytes) return null
  const visible = literalSource(source), start = Math.max(0, position - 1024)
  if (source.slice(start, position) !== visible.slice(start, position)) {
    const line = source.lastIndexOf('\n', position - 1) + 1
    if (source.slice(line, position) !== visible.slice(line, position)) return null
  }
  const match = visible.slice(start, position).match(/(?<!\\)\\(ref|pageref|eqref|autoref|nameref|cref|Cref|cite|citet|citep|parencite|textcite|autocite|footcite|fullcite|citeauthor|citeyear|citeyearpar|nocite|input|include|includegraphics|addbibresource|bibliography|bibliographystyle|documentclass|usepackage|RequirePackage)\*?\s*(?:\[[^\]{}]*\]\s*){0,2}\{([^{}\\%]*)$/u)
  if (!match) return null
  const command = match[1], argument = match[2], token = argument.slice(argument.lastIndexOf(',') + 1)
  const prefix = token.trimStart()
  if (/\s|[{}\\%#]/u.test(prefix)) return null
  const from = position - prefix.length
  let to = position
  while (to < source.length && !/[\s{},\\%#]/u.test(source[to])) to++
  const files = contextFiles(project, file, source), options: LatexArgumentSuggestions['options'] = [], seen = new Set<string>()
  const add = (label: string, detail: string, type: 'constant' | 'text') => {
    if (!label || /[\s{},\\%#]/u.test(label) || !label.startsWith(prefix) || seen.has(label) || options.length >= 256) return
    seen.add(label); options.push({ label, detail, type })
  }
  if (/ref$/u.test(command)) {
    for (const item of files.filter((entry) => /\.(?:tex|sty|cls)$/iu.test(entry.path))) {
      const text = literalSource(item.content), starts = lineStarts(text)
      for (const label of text.matchAll(/(?<!\\)\\label\s*\{([^{}\\%#]+)\}/gu)) add(label[1], `Literal label in ${item.path}:${sourcePosition(starts, label.index!).line}`, 'constant')
    }
  } else if (/cite/u.test(command)) {
    for (const item of files) {
      const text = literalSource(item.content), starts = lineStarts(text)
      if (/\.bib$/iu.test(item.path)) {
        // Skip complete entry bodies, so @article inside a title/comment is not a new key.
        const entries = /@([A-Za-z]+)\s*([{(])/gu
        let entry: RegExpExecArray | null
        while ((entry = entries.exec(text))) {
          const body = entries.lastIndex, key = text.slice(body).match(/^\s*([^\s,{}()=]+)\s*,/u)
          if (!/^(?:comment|string|preamble)$/iu.test(entry[1]) && key) add(key[1], `Literal bibliography key in ${item.path}:${sourcePosition(starts, entry.index).line}`, 'constant')
          const close = entry[2] === '{' ? '}' : ')'
          let depth = 1, braces = 0, quoted = false, at = body
          for (; at < text.length && depth; at++) {
            const character = text[at]
            if (character === '\\') { at++; continue }
            if (entry[2] === '{') { if (character === '{') depth++; else if (character === '}') depth-- }
            else if (character === '{') braces++
            else if (character === '}' && braces) braces--
            else if (!braces && character === '"') quoted = !quoted
            else if (!braces && !quoted && character === close) depth--
          }
          entries.lastIndex = at
        }
      } else if (/\.(?:tex|sty|cls)$/iu.test(item.path)) {
        for (const key of text.matchAll(/(?<!\\)\\bibitem\s*(?:\[[^\]]*\]\s*)?\{([^{}\\%#]+)\}/gu)) add(key[1], `Literal bibliography item in ${item.path}:${sourcePosition(starts, key.index!).line}`, 'constant')
      }
    }
  } else {
    const extension = command === 'includegraphics' ? /\.(?:png|jpe?g)$/iu : command === 'addbibresource' || command === 'bibliography' ? /\.bib$/iu
      : command === 'bibliographystyle' ? /\.bst$/iu : command === 'documentclass' ? /\.cls$/iu : /package|Package/u.test(command) ? /\.sty$/iu : /\.tex$/iu
    for (const item of [...files, ...(files.length ? project?.assets ?? [] : [])]) if (extension.test(item.path)) {
      const label = /^(?:include|bibliography|bibliographystyle|documentclass|usepackage|RequirePackage)$/u.test(command) ? item.path.replace(/\.[^.]+$/u, '') : item.path
      add(label, `Local project path: ${item.path}`, 'text')
    }
  }
  return options.length ? { from, to, options } : null
}
