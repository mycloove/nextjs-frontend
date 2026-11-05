import type { LatexEngine, LatexProfile, LatexProject, LatexTextFile } from './types.ts'

/** Absence from a supplied inventory is not proof that a runtime cannot provide the dependency. */
export type LatexInventoryStatus = 'listed' | 'not-listed' | 'not-recorded' | 'not-determined'
/** Direct means a lexical top-level reference, not verified execution. */
type SourceLocation = { file: string; line: number; command: string; context: 'direct' | 'not-determined' }
export type LatexSourceReference = SourceLocation & {
  kind: 'class' | 'package' | 'source' | 'image' | 'bibliography' | 'bibliography-style'
  requested: string | null
  /** Possible exact project matches, not proof of TeX's runtime file resolution. */
  projectPaths: string[]
  profileAvailability: LatexInventoryStatus
}
export type LatexFontRequest = SourceLocation & {
  requested: string | null
  requestKind: 'family' | 'file' | 'not-determined'
  feature?: string
  profileAvailability: LatexInventoryStatus
  /** Family spelling matched in this profile only, never an actually resolved/embedded PDF font. */
  matchedFamily: string | null
  pdfUsage: 'not-verified'
}
export type LatexBibliographyRequest = SourceLocation & {
  backend: 'biber' | 'bibtex' | null
  evidence: 'explicit-option' | 'biblatex-default' | 'classic-command' | 'not-determined'
}
export type LatexProjectAssessment = {
  mainFile: string | null
  engine: LatexEngine
  profile: { id: LatexEngine; version: string } | null
  /** Potentially reachable through literal references; conditionals/macros are not executed. */
  reachablePaths: string[]
  references: LatexSourceReference[]
  fonts: LatexFontRequest[]
  bibliography: {
    backend: 'biber' | 'bibtex' | 'not-determined' | 'not-requested'
    requests: LatexBibliographyRequest[]
    capabilities: ReturnType<typeof bibliographyCapabilities>
    styles: (SourceLocation & { requested: string | null; profileAvailability: LatexInventoryStatus })[]
    result: 'not-verified'
  }
  inertConfigPaths: string[]
  notDetermined: { file?: string; line?: number; reason: string }[]
  truncated: boolean
  execution: 'not-verified'
  macroExpansion: 'not-determined'
}

type Command = { name: string; start: number; end: number; line: number; depth: number; context: SourceLocation['context'] }
type Argument = { value: string; end: number }
const newlineCount = (text: string) => (text.match(/\r\n|\n|\r/gu) ?? []).length

function skipSpace(source: string, from: number) {
  let at = from
  while (at < source.length) {
    if (/\s/u.test(source[at])) { at++; continue }
    if (source[at] !== '%') break
    while (at < source.length && !/[\r\n]/u.test(source[at])) at++
  }
  return at
}

/** A small balanced argument reader, not a TeX evaluator. Malformed or macro names stay unknown. */
function argument(source: string, from: number, open = '{'): Argument | null {
  const start = skipSpace(source, from)
  if (source[start] !== open) return null
  const stack = [open]
  let value = ''
  for (let at = start + 1; at < source.length; at++) {
    const char = source[at]
    if (char === '%') { while (at < source.length && !/[\r\n]/u.test(source[at])) at++; at--; continue }
    if (char === '\\') { value += source.slice(at, at + 2); at++; continue }
    if (char === '{' || (char === '[' && stack.at(-1) !== '{')) stack.push(char)
    else if (char === '}' || (char === ']' && stack.at(-1) !== '{')) {
      if (stack.pop() !== (char === '}' ? '{' : '[')) return null
      if (!stack.length) return { value, end: at + 1 }
    }
    value += char
  }
  return null
}

/** Comments, escaped commands and verbatim examples cannot become build evidence. */
function* commands(source: string): Generator<Command> {
  let depth = 0, line = 1, target = 0
  const conditionals: number[] = []
  for (let at = 0; at < source.length; at++) {
    const char = source[at]
    if (char === '\r' || (char === '\n' && source[at - 1] !== '\r')) { line++; continue }
    if (char === '%') { while (at < source.length && !/[\r\n]/u.test(source[at])) at++; at--; continue }
    if (char === '{') { depth++; target = 0; continue }
    if (char === '}') { depth = Math.max(0, depth - 1); while (conditionals.length && conditionals.at(-1)! > depth) conditionals.pop(); continue }
    if (char !== '\\') continue
    let end = at + 1
    if (/[A-Za-z@]/u.test(source[end] ?? '')) while (/[A-Za-z@]/u.test(source[end] ?? '')) end++
    else end = Math.min(source.length, end + 1)
    const name = source.slice(at + 1, end)
    if (name === 'verb') {
      const start = source[end] === '*' ? end + 1 : end, delimiter = source[start]
      let finish = start + 1
      while (finish < source.length && source[finish] !== delimiter && !/[\r\n]/u.test(source[finish])) finish++
      at = source[finish] === delimiter ? finish : finish - 1
      continue
    }
    if (name === 'begin') {
      const env = argument(source, end)
      if (env && ['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment'].includes(env.value.trim())) {
        const closing = `\\end{${env.value.trim()}}`, found = source.indexOf(closing, env.end)
        const finish = found < 0 ? source.length : found + closing.length
        line += newlineCount(source.slice(at, finish)); at = finish - 1
        continue
      }
    }
    const context = depth || conditionals.length ? 'not-determined' : 'direct'
    if (target) target--
    else {
      yield { name, start: at, end, line, depth, context }
      if (name === 'endinput' && context === 'direct') return
      if (/^if[A-Za-z@]*$/u.test(name)) conditionals.push(depth)
      else if (name === 'fi') conditionals.pop()
      if (['def', 'gdef', 'edef', 'xdef', 'newif', 'newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand', 'newfontfamily', 'newfontface'].includes(name)) target = 1
      else if (name === 'let' || name === 'futurelet') target = 2
    }
    at = end - 1
  }
}

function commandArgument(source: string, token: Command) {
  let at = skipSpace(source, token.end)
  if (source[at] === '*') at++
  const options = argument(source, at, '[')
  if (options) at = options.end
  return { options, value: argument(source, at), at }
}

/** Main selection is a heuristic only. A filename, macro example or conditional is not a root. */
export function findLatexDocumentRoots(files: readonly LatexTextFile[]): { path: string; className: string | null; line: number }[] {
  const roots: ReturnType<typeof findLatexDocumentRoots> = []
  for (const file of files) {
    if (!/\.tex$/iu.test(file.path)) continue
    let declaration: { className: string | null; line: number } | null = null, begun = false
    for (const token of commands(file.content)) {
      if (token.context !== 'direct' || !['documentclass', 'begin', 'end'].includes(token.name)) continue
      const value = commandArgument(file.content, token).value?.value.trim()
      if (token.name === 'documentclass') {
        if (declaration || begun || value === undefined) break
        declaration = { className: literalPath(value), line: token.line }
      } else if (token.name === 'begin' && value === 'document') {
        if (!declaration || begun) break
        begun = true
      } else if (token.name === 'end' && value === 'document') {
        if (declaration && begun) roots.push({ path: file.path, ...declaration })
        break
      }
    }
  }
  return roots
}

function literalPath(value: string | undefined): string | null {
  const text = value?.trim()
  return text && /^[\p{L}\p{M}\p{N}_.\/-]+$/u.test(text) && !text.startsWith('/') ? text : null
}

function inventory(values: readonly string[] | undefined, requested: string | null): LatexInventoryStatus {
  if (requested === null) return 'not-determined'
  if (!values?.length) return 'not-recorded'
  return values.includes(requested) ? 'listed' : 'not-listed'
}

/** Backend availability is evidence from this profile, never inferred from its runtime or biblatex alone. */
export function bibliographyCapabilities(profile?: LatexProfile | null) {
  return { biber: inventory(profile?.packages, 'biber'),
    bibtex: profile?.packages.some((name) => name === 'classic-bibtex' || name === 'bibtex') ? 'listed' as const : inventory(profile?.packages, 'classic-bibtex'),
    biblatex: inventory(profile?.packages, 'biblatex') }
}

function optionValues(options: string): [string, string][] {
  const result: [string, string][] = []
  let depth = 0, start = 0
  for (let at = 0; at <= options.length; at++) {
    if (options[at] === '\\') { at++; continue }
    if (options[at] === '{') depth++
    else if (options[at] === '}') depth--
    if (at !== options.length && (options[at] !== ',' || depth)) continue
    const part = options.slice(start, at), equals = part.indexOf('=')
    if (equals >= 0) {
      const raw = part.slice(equals + 1).trim(), grouped = argument(raw, 0)
      result.push([part.slice(0, equals).trim(), grouped?.end === raw.length ? grouped.value : raw])
    } else if (part.trim()) result.push([part.trim(), ''])
    start = at + 1
  }
  return result
}

function normalizedReference(path: string): string | null {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') { if (!parts.length) return null; parts.pop() }
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

/** Read-only source hints. No diagnostics/refusals: TeX decides macros, branches, fonts and bibliography output. */
export function assessLatexProject(project: LatexProject, profiles: readonly LatexProfile[] = []): LatexProjectAssessment {
  const profile = profiles.find((item) => item.id === project.engine)
  const result: LatexProjectAssessment = { mainFile: project.mainFile, engine: project.engine, profile: profile ? { id: profile.id, version: profile.version } : null,
    reachablePaths: [], references: [], fonts: [], bibliography: { backend: 'not-requested', requests: [], capabilities: bibliographyCapabilities(profile), styles: [], result: 'not-verified' },
    inertConfigPaths: project.files.filter((file) => /(?:^|\/)latexmkrc$/iu.test(file.path)).map((file) => file.path), notDetermined: [], truncated: false, execution: 'not-verified', macroExpansion: 'not-determined' }
  const main = project.files.find((file) => file.path === project.mainFile)
  if (!main) { result.bibliography.backend = 'not-determined'; result.notDetermined.push({ reason: 'Choose a main .tex file to assess reachable source. Import engine evidence is not recorded in saved projects.' }); return result }
  const pending = [{ file: main, uncertain: false }], visited = new Set<string>(), mainDirectory = main.path.slice(0, main.path.lastIndexOf('/') + 1)
  const classic: LatexBibliographyRequest[] = []
  const dependencies: Record<string, LatexSourceReference['kind']> = { documentclass: 'class', LoadClass: 'class', LoadClassWithOptions: 'class', usepackage: 'package', RequirePackage: 'package', RequirePackageWithOptions: 'package',
    input: 'source', include: 'source', includegraphics: 'image', addbibresource: 'bibliography', bibliography: 'bibliography', bibliographystyle: 'bibliography-style' }
  const special = ['photo', 'photoL', 'photoR', 'setmainfont', 'setsansfont', 'setmonofont', 'newfontfamily', 'newfontface', 'fontspec', 'PassOptionsToPackage', 'printbibliography', 'graphicspath', 'end']
  let remaining = 512, bibliographyMention = false
  const takeEntry = () => { if (remaining > 0) { remaining--; return true }; result.truncated = true; return false }
  const unknown = (location: SourceLocation, reason: string) => {
    if (result.notDetermined.length < 64 && !result.notDetermined.some((item) => item.file === location.file && item.reason === reason)) result.notDetermined.push({ file: location.file, line: location.line, reason })
  }
  const reference = (kind: LatexSourceReference['kind'], value: string | undefined, location: SourceLocation) => {
    if (!takeEntry()) return
    const requested = literalPath(value), extension = { class: '.cls', package: '.sty', source: '.tex', image: '.png', bibliography: '.bib', 'bibliography-style': '.bst' }[kind]
    const names = requested ? /\.[A-Za-z0-9]+$/u.test(requested) ? [requested] : kind === 'image' ? ['.png', '.jpg', '.jpeg'].map((ext) => requested + ext) : [requested + extension] : []
    const directory = location.file.slice(0, location.file.lastIndexOf('/') + 1)
    const candidates = new Set(names.flatMap((name) => [name, mainDirectory + name, directory + name]).map(normalizedReference).filter((path): path is string => path !== null))
    const matches = (kind === 'image' ? project.assets : project.files).filter((file) => candidates.has(file.path))
    const packaged = kind === 'class' || kind === 'package' || kind === 'bibliography-style'
    const name = requested && !requested.includes('/') ? requested.replace(/\.(?:sty|cls|bst)$/u, '') : null
    const entry: LatexSourceReference = { ...location, kind, requested, projectPaths: matches.map((file) => file.path),
      profileAvailability: packaged ? inventory(profile?.packages, name) : 'not-recorded' }
    result.references.push(entry)
    if (!requested) unknown(location, 'A file or package reference is macro-dependent or malformed. Not determined.')
    else if (matches.length > 1) unknown(location, 'More than one project path can match a literal reference. Runtime resolution is not determined.')
    else if (kind === 'source' && !matches.length) unknown(location, 'A literal source reference was not found in this project. Its dependencies are not determined.')
    if (['class', 'package', 'source'].includes(kind)) for (const file of matches) if ('content' in file && /\.(?:tex|sty|cls)$/iu.test(file.path)) pending.push({ file, uncertain: location.context === 'not-determined' || matches.length > 1 })
  }
  const font = (value: string | undefined, location: SourceLocation, options: [string, string][], feature?: string) => {
    if (!takeEntry()) return
    const text = value?.trim(), literal = text && !/[\\{}%#*\r\n]/u.test(text) ? text : null
    const file = Boolean(literal && (/\.(?:otf|ttf|ttc)$/iu.test(literal) || literal.includes('/') || options.some(([key]) => key === 'Path' || key === 'Extension')))
    const matchedFamily = !literal || file ? null : profile?.fonts.find((name) => name.toLowerCase() === literal.toLowerCase()) ?? null
    const availability = !literal || file ? 'not-determined' : matchedFamily ? 'listed' : inventory(profile?.fonts, literal)
    result.fonts.push({ ...location, requested: literal, requestKind: !literal ? 'not-determined' : file ? 'file' : 'family', ...(feature ? { feature } : {}), profileAvailability: availability,
      matchedFamily, pdfUsage: 'not-verified' })
    if (!literal || file) unknown(location, 'Font macros, file lookup and style resolution cannot be established from a family inventory. Not determined.')
  }
  const biblatex = (location: SourceLocation, options: Argument | null, defaultBackend: boolean) => {
    const values = optionValues(options?.value ?? ''), backendOptions = values.filter(([key]) => key === 'backend')
    const indeterminate = values.some(([key]) => /[\\{}#]/u.test(key))
    for (const [, value] of backendOptions.length ? backendOptions : defaultBackend || indeterminate ? [['backend', indeterminate ? '' : 'biber']] : []) {
      if (!takeEntry()) break
      result.bibliography.requests.push({ ...location, backend: !indeterminate && (value === 'biber' || value === 'bibtex') ? value : null,
        evidence: indeterminate || (value !== 'biber' && value !== 'bibtex') ? 'not-determined' : backendOptions.length ? 'explicit-option' : 'biblatex-default' })
    }
    for (const [key, value] of values) if (['style', 'bibstyle', 'citestyle'].includes(key)) {
      if (!takeEntry()) break
      const requested = literalPath(value)
      result.bibliography.styles.push({ ...location, requested, profileAvailability: inventory(profile?.packages, requested ? `biblatex-${requested}` : null) })
    }
  }
  while (pending.length && !result.truncated) {
    const { file, uncertain } = pending.shift()!
    if (visited.has(file.path)) continue
    visited.add(file.path); result.reachablePaths.push(file.path)
    for (const token of commands(file.content)) {
      if (result.truncated) break
      if (!Object.hasOwn(dependencies, token.name) && !special.includes(token.name)) continue
      const location: SourceLocation = { file: file.path, line: token.line, command: token.name, context: uncertain ? 'not-determined' : token.context }
      const { options, value, at } = commandArgument(file.content, token)
      if (Object.hasOwn(dependencies, token.name)) {
        let raw = value?.value
        if (!value && token.name === 'input') raw = /^[^\s{}%\\]+/u.exec(file.content.slice(at))?.[0]
        const kind = dependencies[token.name]
        const values = ['package', 'bibliography'].includes(kind) ? (raw ?? '').split(',') : [raw]
        for (const request of values) {
          if (result.truncated) break
          reference(kind, request, location)
          if (kind === 'package' && request?.trim() === 'biblatex') biblatex(location, options, true)
        }
        if (token.name === 'addbibresource') bibliographyMention = true
        if (token.name === 'bibliography' && takeEntry()) classic.push({ ...location, backend: 'bibtex', evidence: 'classic-command' })
        if (token.name === 'bibliographystyle' && takeEntry()) result.bibliography.styles.push({ ...location, requested: literalPath(raw), profileAvailability: inventory(profile?.packages, literalPath(raw)) })
        if (location.context === 'not-determined') unknown(location, 'References inside conditionals or macro arguments may not execute. Not determined.')
      } else if (['photo', 'photoL', 'photoR'].includes(token.name)) {
        const images = value && argument(file.content, value.end)
        for (const request of (images?.value ?? '').split(',')) { if (result.truncated) break; reference('image', request, location) }
      } else if (['setmainfont', 'setsansfont', 'setmonofont', 'newfontfamily', 'newfontface', 'fontspec'].includes(token.name)) {
        let at = token.end
        if (token.name === 'newfontfamily' || token.name === 'newfontface') {
          at = skipSpace(file.content, at)
          const macro = argument(file.content, at)
          at = macro?.end ?? at + (/^\\[A-Za-z@]+/u.exec(file.content.slice(at))?.[0].length ?? 0)
        }
        const before = argument(file.content, at, '['), requested = argument(file.content, before?.end ?? at)
        const after = requested && argument(file.content, requested.end, '['), values = optionValues([before?.value, after?.value].filter(Boolean).join(','))
        font(requested?.value, location, values)
        for (const [key, value] of values) { if (result.truncated) break; if (['UprightFont', 'BoldFont', 'ItalicFont', 'BoldItalicFont', 'SmallCapsFont'].includes(key)) font(value, location, values, key) }
      } else if (token.name === 'PassOptionsToPackage' && value) {
        const target = argument(file.content, value.end)
        if (target?.value.trim() === 'biblatex') biblatex(location, value, false)
      } else if (token.name === 'printbibliography') {
        bibliographyMention = true
      } else if (token.name === 'graphicspath') {
        unknown(location, 'Graphic search paths may change image lookup. Literal candidate paths are not verified runtime resolution.')
      }
      if (token.name === 'end' && token.context === 'direct' && value?.value.trim() === 'document') break
    }
  }
  if (!result.bibliography.requests.length) result.bibliography.requests.push(...classic)
  const requests = result.bibliography.requests, backends = new Set(requests.map((item) => item.backend))
  const unknownDependencies = result.references.some((item) => ['class', 'package', 'source'].includes(item.kind) && (item.requested === null || (item.kind === 'source' && !item.projectPaths.length)))
  result.bibliography.backend = result.truncated || requests.some((item) => item.backend === null || item.context === 'not-determined') || backends.size > 1 || (!requests.length && (bibliographyMention || unknownDependencies)) ? 'not-determined' : requests[0]?.backend ?? 'not-requested'
  if (result.truncated) result.notDetermined.push({ reason: 'Source assessment reached its 512-entry bound. Remaining dependencies are not determined.' })
  return result
}
