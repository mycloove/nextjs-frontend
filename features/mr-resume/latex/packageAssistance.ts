import { browserPackagePreparation, type BrowserCompilerManifest, type BrowserPreparation } from './browserCompiler.ts'
import { assessLatexProject } from './projectAssessment.ts'
import { captureEditorSnapshot, inspectLatexSource, literalArgument, sourceLines, undefinedControlSequence, type EditorDiagnostic } from './editorDiagnostics.ts'
import { matchesSourceSnapshot } from './workspaceIdentity.ts'
import { LATEX_LIMITS, type LatexProfile, type LatexProject, type LatexRuntime } from './types.ts'

const commandPackages: Readonly<Record<string, string>> = Object.freeze({ '\\includegraphics': 'graphicx', '\\href': 'hyperref', '\\faGithub': 'fontawesome5' })
export type MissingDependencyKind = 'package' | 'class' | 'source' | 'bibliography' | 'bibliography-style' | 'image' | 'font' | 'unknown'
export type PackageAssistance = Readonly<{
  kind: 'declaration' | 'optional-group' | 'missing-project-file' | 'unsupported' | 'ambiguous'
  snapshot: LatexProject; runtime: LatexRuntime; title: string; message: string
  command?: string; packageName?: string; requested?: string; fileKind?: MissingDependencyKind; canImport?: boolean
  groupIds: readonly string[]; availability: 'optional-group' | 'profile-listed' | 'local-project' | 'not-listed' | 'not-recorded'
  /** Inventory and group consent never prove cache presence, installed packages or offline readiness. */
  cache: 'not-checked'
  preparation?: BrowserPreparation
  declaration?: Readonly<{ fileId: string; path: string; from: number; to: number; expectedText: string; replacement: string }>
}>

/** Generic missing_package codes are insufficient. Only an evidenced name determines the file kind. */
export function missingDependency(diagnostic: EditorDiagnostic['diagnostic']): { requested: string; kind: MissingDependencyKind } | null {
  if (diagnostic.severity !== 'error') return null
  const text = `${diagnostic.message}\n${diagnostic.help ?? ''}`
  if (!/not found|cannot be found|can(?:not|'t) find|could not find|couldn't (?:find|open)|not load|failed to (?:find|load)/iu.test(text)) return null
  const names = new Set<string>()
  for (const match of text.matchAll(/[`'"]([^`'"\r\n]+\.[A-Za-z0-9]{1,8})[`'"]/gu)) names.add(match[1])
  if (!names.size) for (const match of text.matchAll(/(?:couldn't open (?:database|style) file|(?:File|file))\s+([^\s`'"]+\.[A-Za-z0-9]{1,8})(?=\s|$)/gu)) names.add(match[1])
  if (names.size > 1) return null
  if (!names.size) {
    const font = /(?:fontspec[^\r\n]*?\bfont|The font)\s+["']([^"'\r\n]{1,160})["']/iu.exec(text)
    return font ? { requested: font[1], kind: 'font' } : null
  }
  const requested = [...names][0], extension = requested.slice(requested.lastIndexOf('.') + 1).toLowerCase()
  const kind: MissingDependencyKind = extension === 'sty' ? 'package' : extension === 'cls' ? 'class' : extension === 'tex' ? 'source'
    : ['bib', 'bbl'].includes(extension) ? 'bibliography' : extension === 'bst' ? 'bibliography-style'
      : ['png', 'jpg', 'jpeg', 'pdf', 'eps', 'svg', 'webp'].includes(extension) ? 'image'
        : ['otf', 'ttf', 'ttc', 'tfm', 'vf', 'woff', 'woff2', 'pfb'].includes(extension) ? 'font' : 'unknown'
  return { requested, kind }
}

type Options = { manifest?: BrowserCompilerManifest | null; profiles?: readonly LatexProfile[]; compilerLog?: string }

/** Curated assistance only. No CTAN lookup, URL, asset fetch, consent write, compile or source mutation. */
export function packageAssistance(project: LatexProject, issue: EditorDiagnostic, options: Options = {}): PackageAssistance | null {
  if (issue.origin !== 'compiler' || issue.diagnostic.severity !== 'error' || !matchesSourceSnapshot(project, issue.snapshot)) return null
  if (project.files.length > LATEX_LIMITS.files || project.files.reduce((sum, file) => sum + file.content.length, 0) > LATEX_LIMITS.sourceBytes) return null
  const snapshot = captureEditorSnapshot(project), runtime = issue.runtime, manifest = runtime === 'browser' ? options.manifest : null
  const profiles = manifest?.engines ?? options.profiles ?? [], profile = profiles.find((item) => item.id === project.engine)
  const assessment = assessLatexProject(project, profiles)
  const missing = missingDependency(issue.diagnostic), evidence = undefinedControlSequence(issue, options.compilerLog)
  const command = evidence?.command
  const packageName = command && Object.hasOwn(commandPackages, command) ? commandPackages[command]
    : missing && ['package', 'class'].includes(missing.kind) && /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:sty|cls)$/u.test(missing.requested) ? missing.requested.replace(/\.(?:sty|cls)$/u, '') : undefined
  const optionalGroups = packageName ? (manifest?.groups ?? []).filter((group) => group.kind === 'package' && group.packages.includes(packageName)) : []
  const groups = optionalGroups.filter((group) => group.profiles.includes(project.engine))
  const availability: PackageAssistance['availability'] = groups.length ? 'optional-group' : profile?.packages.includes(packageName ?? '') ? 'profile-listed' : profile?.packages.length ? 'not-listed' : 'not-recorded'
  const base = { snapshot, runtime, groupIds: Object.freeze(groups.map((group) => group.id)), availability, cache: 'not-checked' as const,
    ...(command ? { command } : {}), ...(packageName ? { packageName } : {}), ...(missing ? { requested: missing.requested, fileKind: missing.kind } : {}) }
  const result = (kind: PackageAssistance['kind'], title: string, message: string, extra: Partial<PackageAssistance> = {}): PackageAssistance => {
    const preparation = kind === 'optional-group' && manifest ? browserPackagePreparation(manifest, project.engine, base.groupIds) : null
    return Object.freeze({ ...base, kind, title, message, ...(preparation ? { preparation } : {}), ...extra })
  }
  const canImport = Boolean(missing && /\.(?:tex|sty|cls|bib|bst|md|txt|png|jpe?g)$/iu.test(missing.requested) && /^[\p{L}\p{M}\p{N}_.\/-]+$/u.test(missing.requested) && !missing.requested.split('/').some((part) => !part || part === '.' || part === '..'))
  if (missing && ['package', 'class'].includes(missing.kind) && missing.requested.includes('/') && canImport) {
    const mainDirectory = project.mainFile?.slice(0, project.mainFile.lastIndexOf('/') + 1) ?? ''
    const supplied = project.files.some((file) => file.path === missing.requested || file.path === mainDirectory + missing.requested)
    return result(supplied ? 'ambiguous' : 'missing-project-file', supplied ? 'Template source path needs review' : 'Missing template source file',
      supplied ? `${missing.requested} is already in this project. Review its relative reference rather than replacing it or downloading a package.`
        : `Add the original .sty/.cls file and preserve the referenced relative path ${missing.requested}. No package download is inferred.`,
      { canImport: !supplied, groupIds: Object.freeze([]), availability: supplied ? 'local-project' : 'not-recorded' })
  }
  if (missing && !['package', 'class'].includes(missing.kind)) {
    return result('missing-project-file', `Missing ${missing.kind === 'unknown' ? 'project' : missing.kind} file`,
      missing.kind === 'font' ? 'Review the requested font and selected engine inventory. Font files are not supported project uploads; this is not a package-install action.'
        : `Review the project path for ${missing.requested}.${canImport ? ' Add the supported local file or correct its reference.' : ' This file type or path cannot be imported here; export the source or choose a supported resource explicitly.'} No package download is inferred.`, { canImport, groupIds: Object.freeze([]), availability: 'not-recorded' })
  }
  if (!packageName) {
    if (!missing && !/\bUndefined control sequence\b/iu.test(issue.diagnostic.message) && issue.diagnostic.code !== 'missing_package') return null
    return result('ambiguous', 'Dependency not determined', 'The compiler evidence does not identify one supported command or package. Custom macros and missing project files are not package-install requests.')
  }
  const localPaths = assessment.references.filter((reference) => reference.requested?.replace(/\.(?:sty|cls)$/u, '') === packageName && ['class', 'package'].includes(reference.kind)).flatMap((reference) => reference.projectPaths)
  if (localPaths.length) return result('ambiguous', 'Local dependency needs review', `A reachable project class or package may provide ${packageName}: ${[...new Set(localPaths)].join(', ')}. Review local definitions and paths rather than downloading over them.`, { availability: 'local-project', groupIds: Object.freeze([]) })
  if (optionalGroups.length && !groups.length && !manifest?.groups?.some((group) => group.kind !== 'package' && group.profiles.includes(project.engine) && group.packages.includes(packageName))) return result('unsupported', 'No compatible optional package group', `${packageName} is not in a compatible optional group for ${project.engine}. No group consent or download action is proposed.`)
  if (runtime === 'browser' && manifest && (!profile || (!groups.length && availability !== 'profile-listed'))) return result('unsupported', 'No supported browser package action', `${packageName} is not listed for this pinned browser engine. This is a limitation of the curated assistance, not proof that all TeX installations lack it. If this is a template-specific dependency, add its original .sty/.cls file and preserve the referenced relative path. Otherwise export the project or choose a runtime explicitly.`, { canImport })
  if (!profile || availability === 'not-recorded' || availability === 'not-listed') return result('ambiguous', 'Package availability not established', `${packageName} is a possible provider, but the selected engine inventory does not establish a supported package action. No installation or cache status was inferred.`)
  if (missing) {
    if (groups.length) return result('optional-group', 'Review supported package group', `${packageName} is listed in ${groups.map((group) => group.id).join(', ')}. Use the compiler's preparation review for pinned groups and complete byte totals. Approval records consent; assets are fetched and verified later during compilation.`)
    return result('ambiguous', 'Listed dependency failed to load', `${packageName} is listed in this profile, but inventory is not installed/cache state. Review the compiler output and local paths; adding another declaration or claiming a completed download would be misleading.`)
  }
  if (!command || !evidence || !issue.path || !assessment.reachablePaths.includes(issue.path)) return result('ambiguous', 'Command context is not determined', 'A declaration cannot be proposed without an exact compiler-identified command in reachable source.')
  const declared = assessment.references.filter((reference) => reference.kind === 'package' && reference.requested?.replace(/\.sty$/u, '') === packageName)
  if (declared.length) return result('ambiguous', 'Package declaration already present', `${packageName} is already referenced in reachable source. A conditional, local macro or package version may explain the undefined command; do not add a duplicate declaration.`)
  if (packageName === 'fontawesome5' && assessment.references.some((reference) => reference.kind === 'package' && reference.requested?.replace(/\.sty$/u, '') === 'fontawesome')) return result('ambiguous', 'Another icon package is referenced', 'The older fontawesome package may provide the same command. Review the version and local definitions rather than adding a conflicting icon package.')
  if (assessment.truncated || assessment.references.some((reference) => ['source', 'class', 'package'].includes(reference.kind) && (reference.context !== 'direct' || !reference.requested || reference.projectPaths.length > 1
    || (!reference.projectPaths.length && (reference.kind === 'source' || !profile.packages.includes(reference.requested.replace(/\.(?:sty|cls)$/u, ''))))))) {
    return result('ambiguous', 'Reachable declarations are not determined', 'An unresolved import, conditional or ambiguous local path may provide this command or its package. Review those sources before adding a declaration.')
  }
  for (const path of assessment.reachablePaths) {
    const file = project.files.find((item) => item.path === path)!
    const scan = inspectLatexSource(file.content)
    if (!scan.bounded || scan.undetermined.length) return result('ambiguous', 'Local command definitions need review', `Macros or syntax changes in ${path} may define or alter ${command}. The curated helper does not execute them or insert a package around them.`)
  }
  const main = project.files.find((file) => file.path === project.mainFile)
  if (!main) return result('ambiguous', 'Choose a document preamble', 'A safe main-file preamble is required before proposing a package declaration.')
  const scan = inspectLatexSource(main.content), classes = scan.commands.filter((token) => token.name === 'documentclass' && token.depth === 0)
  const documents = scan.environments.filter((token) => token.opening && token.name === 'document')
  const begin = documents[0], bounds = begin && sourceLines(main.content).find((line) => begin.from >= line.from && begin.from <= line.to)
  // Keep the insertion out of command arguments, macro bodies, comments and inline document openers.
  if (classes.length !== 1 || !literalArgument(scan.visible.replace(/(\\documentclass\s*)\[[^\]]*\]/u, '$1'), classes[0].to) || documents.length !== 1 || !bounds
    || !scan.commands.some((token) => token.from === begin.from && token.depth === 0)
    || classes[0].from >= begin.from || main.content.slice(bounds.from, begin.from).trim()) {
    return result('ambiguous', 'No safe declaration position', 'Review the main-file preamble manually. The helper only inserts before a standalone literal document opener after one document-class declaration.')
  }
  const before = main.content.slice(0, bounds.from), separator = /(?:\r\n|\r|\n)$/u.exec(before)?.[0] ?? /\r\n|\r|\n/u.exec(main.content.slice(bounds.from))?.[0] ?? '\n'
  return result('declaration', `Add ${packageName} declaration`,
    `${command} has a curated provider, ${packageName}, and no declaration was found in the determined reachable source.${groups.length ? ' Its optional group may still require consent and loading on compile.' : ' The profile lists the package; this does not prove it is cached or initialized.'} Review this source-only insertion before applying.`,
    { declaration: Object.freeze({ fileId: main.id, path: main.path, from: bounds.from, to: bounds.from, expectedText: '', replacement: `\\usepackage{${packageName}}${separator}` }) })
}
