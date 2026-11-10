import { LATEX_LIMITS, LATEX_MAIN_FILE_NOTICE, type LatexCapabilities, type LatexDiagnostic, type LatexEngine, type LatexProfile, type LatexProject, type LatexProof } from './types.ts'
import { assertLatexPath, isRecord, sameProjectSource, validateLatexProject } from './project.ts'
import { awaitLatexSignal, compareLatexPaths, readBoundedLatexBytes, readLatexCapabilities, readLatexCompileResult, readLatexId, readLatexManifest } from './server/contract.ts'
import { LatexTransportError } from './compileTransport.ts'
import type { BrowserPdfVerification } from './browserPdfVerification.ts'
import { engineAssetStore, type EngineAssetPin, type EngineAssetStore, type EngineCacheSummary } from './engineAssetStore.ts'
import { BROWSER_LATEX_MANIFEST_PIN } from './browserManifestPin.ts'
import { inspectBrowserSyncArtifact, type BrowserSyncArtifact } from './browserSynctex.ts'
import { proofActionIdentity } from './workspaceIdentity.ts'

export const BROWSER_LATEX_ROOT = '/mr-resume/latex/busytex-v2/'
export const BROWSER_LATEX_PROFILE_VERSION = 'browser-busytex-v2-tl2023-4499aa69-altacv-synctex-r2'
export const BROWSER_LATEX_COMPILE_TIMEOUT_MS = 180000
export type BrowserCompilerGroup = {
  id: string
  kind: 'core' | 'profile' | 'package'
  profiles: LatexEngine[]
  packages: string[]
  files?: string[]
  requires?: string[]
  archive: string
  index: string
  assets: EngineAssetPin[]
}
export type BrowserPreparation = { profileVersion: string; groups: BrowserCompilerGroup[]; downloadBytes: number }
export type BrowserBiberTool = { group: string; version: string; assets: EngineAssetPin[] }
export type BrowserCompilerManifest = {
  version: 1
  profileVersion: string
  engines: LatexProfile[]
  assets: EngineAssetPin[]
  groups?: BrowserCompilerGroup[]
  biber?: BrowserBiberTool
  synctex?: EngineAssetPin
  limitations: string[]
}
export type LatexEngineAssetAudit = EngineAssetPin & {
  source: 'indexeddb-reuse' | 'fetch-response'
  groupId: string
  groupKind: BrowserCompilerGroup['kind'] | 'runtime' | 'bundle'
  packages: string[]
}
export type LatexCompileProgress = { phase: 'loading' | 'initializing' | 'compiling' | 'verifying'; message: string; pass?: number; downloadedBytes?: number; verifiedBytes?: number; totalBytes?: number; cachedBytes?: number; assetPath?: string; assetAudit?: LatexEngineAssetAudit[];
  buildContext?: { profileVersion: string; manifest: { path: string; bytes: number; sha256: string }; profile: LatexProfile } }
export type BrowserCompilerWorker = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null
  postMessage: { (message: unknown): void; (message: unknown, transfer: Transferable[]): void }
  terminate: () => void
}
export type BrowserCompileOptions = {
  onSyncArtifact?: (artifact: BrowserSyncArtifact) => void
  /** Explicit selection from a reviewed download, not a grant of asset consent. */
  packageGroups?: readonly string[]
  /** Only package-assisted retries opt in; explicit compiles keep their captured snapshot. */
  mayStartAfterPreparation?: () => boolean
}
type Dependencies = {
  request?: (url: string, init: RequestInit) => Promise<Response>
  createWorker?: () => BrowserCompilerWorker
  verifyPdf?: (data: ArrayBuffer, signal: AbortSignal) => Promise<BrowserPdfVerification>
  inspectSyncArtifact?: typeof inspectBrowserSyncArtifact
  supported?: () => boolean
  online?: () => boolean
  assetStore?: EngineAssetStore
  manifestPin?: { bytes: number; sha256: string }
  crypto?: Crypto
  now?: () => number
  capabilitiesTimeoutMs?: number
  loadingTimeoutMs?: number
  compileTimeoutMs?: number
}

const runtimeBasename = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(value)
  && /\.(?:sty|cls|tex|def|cfg|bbx|cbx|dbx|bst|fd|tfm|vf|map|enc|otf|ttf)$/i.test(value)

function packageGroupClosure(groups: readonly BrowserCompilerGroup[], engine: LatexEngine, ids: readonly string[]): BrowserCompilerGroup[] | null {
  if (groups.length > 29 || ids.length > 29 || new Set(ids).size !== ids.length) return null
  const selected = new Set<string>(), visiting = new Set<string>()
  const visit = (id: string): boolean => {
    if (selected.has(id)) return true
    const group = groups.find((item) => item.id === id)
    if (!group || group.kind !== 'package' || !group.profiles.includes(engine) || visiting.has(id) || visiting.size >= 29) return false
    if (group.requires !== undefined && (!Array.isArray(group.requires) || group.requires.length > 29 || new Set(group.requires).size !== group.requires.length)) return false
    visiting.add(id)
    if ([...(group.requires ?? [])].some((dependency) => !visit(dependency))) return false
    visiting.delete(id); selected.add(id)
    return true
  }
  return [...ids].every(visit) ? groups.filter((group) => selected.has(group.id)) : null
}

export function readBrowserCompilerManifest(input: unknown): BrowserCompilerManifest {
  if (!isRecord(input) || input.version !== 1 || typeof input.profileVersion !== 'string' || input.profileVersion.length > 256 || !input.profileVersion.startsWith('browser-')
    || !Array.isArray(input.assets) || input.assets.length < 3 || input.assets.length > 64 || !Array.isArray(input.limitations) || input.limitations.length > 32
    || input.limitations.some((item) => typeof item !== 'string' || item.length > 2048)) throw new Error('The browser compiler asset manifest is invalid.')
  const capabilities = readLatexCapabilities({ enabled: true, ready: true, reason: '', profiles: input.engines, limits: LATEX_LIMITS })
  const paths = new Map<string, { path: string; file: boolean }>()
  let totalBytes = 0, assetCount = 0
  const pin = (value: unknown): EngineAssetPin => {
    if (!isRecord(value) || Object.keys(value).length !== 3 || Object.keys(value).some((key) => !['path', 'bytes', 'sha256'].includes(key))
      || typeof value.path !== 'string' || value.path.length > 256 || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/.test(value.path)
      || !Number.isSafeInteger(value.bytes) || (value.bytes as number) < 1 || (value.bytes as number) > 96 * 1024 * 1024
      || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) throw new Error('The browser compiler has an invalid or unsafe asset entry.')
    const parts = value.path.split('/')
    for (let at = 1; at <= parts.length; at++) {
      const path = parts.slice(0, at).join('/'), file = at === parts.length, previous = paths.get(path.toLowerCase())
      if (previous && (previous.path !== path || previous.file !== file || file)) throw new Error('The browser compiler has duplicate assets or path aliases.')
      paths.set(path.toLowerCase(), { path, file })
    }
    totalBytes += value.bytes as number
    if (++assetCount > 64 || totalBytes > 256 * 1024 * 1024) throw new Error('The browser compiler asset bundle exceeds its limit.')
    return { path: value.path, bytes: value.bytes as number, sha256: value.sha256 }
  }
  const assets = input.assets.map((value) => {
    if (!isRecord(value) || typeof value.path !== 'string' || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(value.path)) throw new Error('The browser compiler has an unsafe top-level asset path.')
    return pin(value)
  })
  if (!['compiler-worker.js', 'busytex.js.bin', 'busytex.wasm', 'snapshot-index.json', 'texlive.snapshot.tar.gz'].every((path) => assets.some((asset) => asset.path === path))) throw new Error('The browser compiler asset bundle is incomplete.')
  let groups: BrowserCompilerGroup[] | undefined
  if (Object.hasOwn(input, 'groups')) {
    if (!Array.isArray(input.groups) || !input.groups.length || input.groups.length > 29) throw new Error('The browser compiler group list is invalid.')
    const ids = new Set<string>()
    let fileCount = 0
    groups = input.groups.map((value) => {
      if (!isRecord(value) || Object.keys(value).length !== 7 + Number(Object.hasOwn(value, 'files')) + Number(Object.hasOwn(value, 'requires')) || Object.keys(value).some((key) => !['id', 'kind', 'profiles', 'packages', 'files', 'requires', 'archive', 'index', 'assets'].includes(key))
        || typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.id) || ids.has(value.id) || typeof value.kind !== 'string' || !['core', 'profile', 'package'].includes(value.kind)
        || !Array.isArray(value.profiles) || !value.profiles.length || value.profiles.length > 3 || new Set(value.profiles).size !== value.profiles.length || value.profiles.some((id) => !capabilities.profiles.some((profile) => profile.id === id))
        || !Array.isArray(value.packages) || value.packages.length > 128 || value.packages.some((name) => typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name))
        || new Set(value.packages.map((name: string) => name.toLowerCase())).size !== value.packages.length || (value.kind === 'package' && !value.packages.length)
        || typeof value.archive !== 'string' || !value.archive.startsWith(`groups/${value.id}/`) || !value.archive.endsWith('.tar.gz')
        || typeof value.index !== 'string' || !value.index.startsWith(`groups/${value.id}/`) || !value.index.endsWith('.json') || !Array.isArray(value.assets) || value.assets.length !== 2) throw new Error('The browser compiler has an invalid package or profile group.')
      if (Object.hasOwn(value, 'files') && (!Array.isArray(value.files) || value.files.length > 8192 || [...value.files].some((name) => !runtimeBasename(name)) || new Set(value.files).size !== value.files.length)) throw new Error('A browser compiler group has an invalid runtime filename inventory.')
      if (Object.hasOwn(value, 'requires') && (!Array.isArray(value.requires) || value.requires.length > 29 || [...value.requires].some((id) => typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) || new Set(value.requires).size !== value.requires.length)) throw new Error('A browser compiler group has invalid package dependencies.')
      fileCount += (value.files as string[] | undefined)?.length ?? 0
      if (fileCount > 32768) throw new Error('The browser compiler runtime filename inventory exceeds its limit.')
      ids.add(value.id)
      const assets = value.assets.map(pin)
      if (!assets.every((asset) => asset.path === value.archive || asset.path === value.index) || !assets.some((asset) => asset.path === value.archive) || !assets.some((asset) => asset.path === value.index)
        || (value.kind === 'package' && assets.find((asset) => asset.path === value.archive)!.bytes > 12 * 1024 * 1024)) throw new Error('A browser compiler group has unlisted or oversized assets.')
      return { id: value.id, kind: value.kind as BrowserCompilerGroup['kind'], profiles: [...value.profiles] as LatexEngine[], packages: [...value.packages] as string[], archive: value.archive, index: value.index, assets,
        ...(Array.isArray(value.files) ? { files: [...value.files] as string[] } : {}), ...(Array.isArray(value.requires) ? { requires: [...value.requires] as string[] } : {}) }
    })
    if (!groups.some((group) => group.kind === 'core') || capabilities.profiles.some((profile) => !groups!.some((group) => group.kind === 'profile' && group.profiles.includes(profile.id)))) throw new Error('The grouped compiler is missing its core or an advertised engine profile.')
    if (groups.some((group) => group.profiles.some((engine) => !packageGroupClosure(groups!, engine, group.kind === 'package' ? [group.id] : group.requires ?? [])))) throw new Error('The browser compiler has unknown, cyclic or engine-incompatible package dependencies.')
  }
  let biber: BrowserBiberTool | undefined
  if (Object.hasOwn(input, 'biber')) {
    const tool = input.biber
    const names = ['biber.js.bin', 'biber.wasm', 'biber.data', 'biber-index.json']
    if (!isRecord(tool) || Object.keys(tool).length !== 3 || Object.keys(tool).some((key) => !['group', 'version', 'assets'].includes(key))
      || typeof tool.group !== 'string' || !groups?.some((group) => group.id === tool.group && group.kind === 'package' && group.packages.includes('biblatex'))
      || tool.version !== '2.22' || !Array.isArray(tool.assets) || tool.assets.length !== names.length) throw new Error('The browser bibliography tool is invalid or has no pinned package group.')
    const assets = tool.assets.map(pin)
    if (!names.every((name) => assets.some((asset) => asset.path === `tools/biber/${name}`))) throw new Error('The pinned Biber tool is incomplete.')
    biber = { group: tool.group, version: tool.version, assets }
  }
  if (capabilities.profiles.some((profile) => profile.packages.includes('biber') && (!biber || !groups?.find((group) => group.id === biber.group)?.profiles.includes(profile.id)))) throw new Error('A profile advertises Biber without its pinned, engine-compatible tool.')
  const synctex = Object.hasOwn(input, 'synctex') ? pin(input.synctex) : undefined
  if (synctex && (synctex.path !== 'tools/synctex/synctex-parser.wasm' || synctex.bytes > 2 * 1024 * 1024)) throw new Error('The browser SyncTeX parser pin is invalid.')
  return { version: 1, profileVersion: input.profileVersion, engines: capabilities.profiles, assets, ...(groups ? { groups } : {}), ...(biber ? { biber } : {}), ...(synctex ? { synctex } : {}), limitations: [...input.limitations] as string[] }
}

const copyGroup = (group: BrowserCompilerGroup): BrowserCompilerGroup => ({ ...group, profiles: [...group.profiles], packages: [...group.packages], assets: group.assets.map((pin) => ({ ...pin })),
  ...(group.files ? { files: [...group.files] } : {}), ...(group.requires ? { requires: [...group.requires] } : {}) })
function preparationFor(bundle: BrowserCompilerManifest, groups: BrowserCompilerGroup[]): BrowserPreparation {
  const biber = bundle.biber
  return { profileVersion: bundle.profileVersion, groups: groups.map(copyGroup).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), downloadBytes: groups.reduce((sum, group) => sum + group.assets.reduce((bytes, pin) => bytes + pin.bytes, 0), 0) + (biber && groups.some((group) => group.id === biber.group) ? biber.assets.reduce((bytes, pin) => bytes + pin.bytes, 0) : 0) }
}

/** Exact compatible inventory only, without consent or cache-readiness claims. */
export function browserPackagePreparation(bundle: BrowserCompilerManifest, engine: LatexEngine, groupIds: readonly string[]): BrowserPreparation | null {
  if (!bundle.engines.some((profile) => profile.id === engine) || !Array.isArray(groupIds) || !groupIds.length || groupIds.length > 29 || new Set(groupIds).size !== groupIds.length) return null
  const groups = packageGroupClosure(bundle.groups ?? [], engine, groupIds)
  return groups ? preparationFor(bundle, groups) : null
}

/** Public byte inventory only; presence or consent is not a claim of an offline-ready engine. */
export function browserEngineAssetPins(bundle: BrowserCompilerManifest, engine: LatexEngine, packageGroups: readonly string[] = []): EngineAssetPin[] {
  const base = bundle.groups?.filter((group) => group.kind !== 'package' && group.profiles.includes(engine))
  const packages = packageGroupClosure(bundle.groups ?? [], engine, [...new Set([...packageGroups, ...(base ?? []).flatMap((group) => group.requires ?? [])])])
  if (!packages) throw new Error('The selected browser package dependencies are invalid or incompatible.')
  const groups = bundle.groups?.filter((group) => base!.includes(group) || packages.includes(group))
  const biber = bundle.biber
  const pins = groups ? [...bundle.assets.filter((pin) => ['compiler-worker.js', 'busytex.js.bin', 'busytex.wasm'].includes(pin.path)), ...groups.flatMap((group) => group.assets), ...(biber && groups.some((group) => group.id === biber.group) ? biber.assets : [])] : bundle.assets
  return [...pins, ...(bundle.synctex ? [bundle.synctex] : [])].map((pin) => ({ ...pin }))
}

export class BrowserPackageGroupRequiredError extends LatexTransportError {
  readonly preparation: BrowserPreparation
  constructor(preparation: BrowserPreparation, operationKey?: string, log = '') {
    super({ error: 'This source needs pinned public package groups. Approve their download explicitly before compiling again; no source is uploaded or changed.', code: 'package_group_required', request_id: operationKey ? `browser-${operationKey}` : 'browser-preparation', operationKey, log })
    this.name = 'BrowserPackageGroupRequiredError'
    this.preparation = { ...preparation, groups: preparation.groups.map(copyGroup) }
  }
}

const withoutTexComments = (source: string) => source.replace(/(^|[^\\])((?:\\\\)*)%[^\r\n]*/g, '$1$2')

/** Literal dependency discovery only; the real engine remains authoritative for macros. */
function referencedBrowserSources(project: LatexProject, profile?: LatexProfile) {
  const filenames = new Set<string>(), visited = new Set<string>()
  const pending = project.files.filter((file) => file.path === project.mainFile)
  const mainDirectory = project.mainFile?.slice(0, project.mainFile.lastIndexOf('/') + 1) ?? ''
  const normalize = (path: string) => {
    const parts: string[] = []
    for (const part of path.split('/')) {
      if (part === '..') { if (!parts.length) return ''; parts.pop() }
      else if (part && part !== '.') parts.push(part)
    }
    return parts.join('/')
  }
  while (pending.length) {
    const file = pending.shift()!
    if (visited.has(file.path)) continue
    visited.add(file.path)
    const raw = file.content, masked: string[] = [], literals = /%|\\(?:verb\b\*?|begin\s*\{(verbatim\*?|Verbatim|lstlisting|minted|comment)\})/g
    let cursor = 0, token: RegExpExecArray | null
    // Literal examples are not package requests. Scan disjoint regions so even
    // an unfinished verbatim block is bounded and cannot invent a download.
    while ((token = literals.exec(raw))) {
      let slashes = 0
      for (let at = token.index - 1; at >= 0 && raw[at] === '\\'; at--) slashes++
      if (slashes % 2) continue
      let end = literals.lastIndex
      if (token[1]) {
        const marker = `\\end{${token[1]}}`, close = raw.indexOf(marker, end)
        end = close < 0 ? raw.length : close + marker.length
      } else {
        const delimiter = token[0] === '%' ? undefined : raw[end]
        if (delimiter && delimiter !== '\r' && delimiter !== '\n') end++
        while (end < raw.length && raw[end] !== '\r' && raw[end] !== '\n' && raw[end] !== delimiter) end++
        if (delimiter && delimiter !== '\r' && delimiter !== '\n' && raw[end] === delimiter) end++
      }
      masked.push(raw.slice(cursor, token.index), ' '); cursor = end; literals.lastIndex = end
    }
    const text = masked.join('') + raw.slice(cursor), source = visibleEngineSource(text, project.engine) ?? text, directory = file.path.slice(0, file.path.lastIndexOf('/') + 1)
    const reference = (value: string, extension: string) => {
      const literal = value.trim()
      if (!literal || /[\s\\{}%#\[\]:\x00-\x1f\x7f]/.test(literal) || literal.startsWith('/')) return
      const path = /\.[A-Za-z0-9]+$/.test(literal) ? literal : literal + extension
      const candidates = [path, mainDirectory + path, directory + path].map(normalize)
      const dependency = candidates.map((path) => project.files.find((item) => item.path === path)).find(Boolean)
      if (dependency) pending.push(dependency)
      // A missing authored path must not be reinterpreted as a runtime basename.
      else if (runtimeBasename(path)) filenames.add(path)
    }
    const bibliographyOptions = (options: string) => {
      for (const match of options.matchAll(/(?:^|,)\s*(style|bibstyle|citestyle|datamodel)\s*=\s*(?:\{([A-Za-z0-9][A-Za-z0-9._-]*)\}|([A-Za-z0-9][A-Za-z0-9._-]*))\s*(?=,|$)/g)) {
        const name = match[2] ?? match[3]
        for (const extension of match[1] === 'style' ? ['.bbx', '.cbx'] : [match[1] === 'bibstyle' ? '.bbx' : match[1] === 'citestyle' ? '.cbx' : '.dbx']) reference(name + extension, extension)
      }
    }
    for (const match of source.matchAll(/(?<!\\)\\(usepackage|RequirePackage(?:WithOptions)?|documentclass|LoadClass(?:WithOptions)?|input|include)\b\s*(?:\[([^\]]*)\]\s*)?(?:\{([^{}]*)\}|([^\s{}%\\]+))/g)) {
      const command = match[1], input = command === 'input' || command === 'include', extension = input ? '.tex' : /class|Class/.test(command) ? '.cls' : '.sty'
      const names = (match[3] ?? (input ? match[4] : '') ?? '').split(',')
      for (const value of names) reference(value, extension)
      if (extension === '.sty' && names.some((name) => name.trim() === 'biblatex')) bibliographyOptions(match[2] ?? '')
    }
    for (const match of source.matchAll(/(?<!\\)\\(?:sub)?(?:import|inputfrom|includefrom)\b\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g)) reference(match[1] + match[2], '.tex')
    for (const match of source.matchAll(/(?<!\\)\\(usetikzlibrary|usepgflibrary|tcbuselibrary|RequireBibliographyStyle|RequireCitationStyle|bibliographystyle)\b\s*\{([^{}]*)\}/g)) {
      for (const name of match[2].split(',').map((name) => name.trim())) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) continue
        const extension = match[1] === 'RequireBibliographyStyle' ? '.bbx' : match[1] === 'RequireCitationStyle' ? '.cbx' : match[1] === 'bibliographystyle' ? '.bst' : '.code.tex'
        const prefix = match[1] === 'usetikzlibrary' ? 'tikzlibrary' : match[1] === 'usepgflibrary' ? 'pgflibrary' : match[1] === 'tcbuselibrary' ? 'tcb' : ''
        reference(prefix + name + extension, extension)
      }
    }
    for (const match of source.matchAll(/(?<!\\)\\(?:ExecuteBibliographyOptions\s*\{([^{}]*)\}|PassOptionsToPackage\s*\{([^{}]*)\}\s*\{biblatex\})/g)) bibliographyOptions(match[1] ?? match[2])
    if (project.engine !== 'pdflatex') {
      // These two advertised families have verified regular faces in cv-fonts.
      // Never manufacture a filename from an arbitrary font-family name.
      const families: Record<string, string> = { Lato: 'Lato-Regular.ttf', 'Roboto Slab': 'RobotoSlab-Regular.otf' }
      for (const match of source.matchAll(/(?<!\\)\\(?:set(?:main|sans|mono)font\b|newfont(?:family|face)\s*\\[A-Za-z@]+)\s*(?:\[([^\]]*)\]\s*)?\{([^{}\\]*)\}\s*(?:\[([^\]]*)\])?/g)) {
        const name = match[2].trim(), options = `${match[1] ?? ''},${match[3] ?? ''}`
        if (/\b(?:Path|Extension|UprightFont)\s*=/.test(options)) continue
        if (runtimeBasename(name) && /\.(?:otf|ttf)$/i.test(name)) reference(name, '')
        else if (Object.hasOwn(families, name) && profile?.fonts.includes(name)) reference(families[name], '')
      }
    }
  }
  return filenames
}

/** Mask provable iftex branches for source review, never for compilation. */
function visibleEngineSource(source: string, engine: LatexEngine) {
  const conditions: Record<string, boolean> = { ifPDFTeX: engine === 'pdflatex', ifpdftex: engine === 'pdflatex', ifXeTeX: engine === 'xelatex', ifxetex: engine === 'xelatex', ifLuaTeX: engine === 'lualatex', ifluatex: engine === 'lualatex', ifTUTeX: engine !== 'pdflatex', iftutex: engine !== 'pdflatex' }
  const tokens = [...source.matchAll(/(?<!\\)\\(if[A-Za-z@]+|else|fi)\b/gu)]
  // Unknown conditionals/macros are conservative: never pair their else/fi
  // with a known engine guard or guess which source they execute.
  if (tokens.some((token) => token[1].startsWith('if') && !Object.hasOwn(conditions, token[1]))) return null
  const stack: { parent: boolean; condition: boolean; alternate: boolean }[] = []
  let visible = true, cursor = 0, result = ''
  const mask = (text: string) => text.replace(/[^\r\n]/gu, ' ')
  for (const token of tokens) {
    const at = token.index!, command = token[1], text = source.slice(cursor, at)
    result += visible ? text : mask(text)
    result += mask(token[0]); cursor = at + token[0].length
    if (Object.hasOwn(conditions, command)) {
      const condition = conditions[command]
      stack.push({ parent: visible, condition, alternate: false }); visible = visible && condition
    } else if (command === 'else') {
      const frame = stack.at(-1)
      if (!frame || frame.alternate) return null
      frame.alternate = true; visible = frame.parent && !frame.condition
    } else {
      const frame = stack.pop()
      if (!frame) return null
      visible = frame.parent
    }
  }
  return stack.length ? null : result + (visible ? source.slice(cursor) : mask(source.slice(cursor)))
}

/** A source review is best effort, not a claim to statically understand arbitrary TeX macros. */
export function browserLatexCompatibility(project: LatexProject, profiles: readonly LatexProfile[]): LatexDiagnostic[] {
  if (!profiles.some((profile) => profile.id === project.engine)) return [{ severity: 'error', code: 'browser_engine_unsupported', message: 'The selected engine is not included in this browser bundle.', help: 'Choose an engine shown in browser settings, or explicitly select the private native runtime. Source is never converted to another engine silently.' }]
  const issues: LatexDiagnostic[] = []
  const profile = profiles.find((item) => item.id === project.engine)!
  // Unused archive/source files are not a preamble. Included classes/packages
  // may contain inactive engine branches; the real engine decides those.
  for (const file of project.files.filter((item) => item.path === project.mainFile)) {
    const raw = withoutTexComments(file.content), visible = visibleEngineSource(raw, project.engine)
    // Macro bodies and verbatim examples are not proof of executed commands.
    // This advisory preflight never expands them or refuses an unknown branch;
    // worker shell/network limits and the real final-log gate still apply.
    if (visible === null || /\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand|NewDocumentCommand|RenewDocumentCommand|def|gdef|edef|xdef|let|futurelet|csname|verb)\b|\\begin\s*\{(?:verbatim\*?|Verbatim|lstlisting|minted|comment)\}/u.test(raw)) {
      issues.push({ severity: 'info', file: file.path, code: 'browser_compatibility_not_determined', message: 'Static engine compatibility is not determined for this source\'s macros or conditionals.', help: 'The original source is unchanged. The isolated real compiler and final PDF checks decide compatibility.' })
      continue
    }
    visible.split(/\r\n|\n|\r/).forEach((line, index) => {
      // An escaped percent is source, not the start of a comment.
      const source = withoutTexComments(line)
      if (!profile.packages.includes('biber') && /\\(?:usepackage|RequirePackage)(?:\s*\[[^\]]*\])?\s*\{[^}]*\bbiblatex\b/.test(source)) issues.push({ severity: 'error', code: 'browser_biber_unsupported', file: file.path, line: index + 1, message: 'This browser profile does not implement the biblatex/Biber workflow.', help: 'Keep this source unchanged and choose a profile with pinned Biber support. A classic BibTeX document is a different workflow, not a silent substitute.' })
      if (project.engine === 'pdflatex' && /\\(?:usepackage|RequirePackage)(?:\s*\[[^\]]*\])?\s*\{[^}]*\b(?:fontspec|polyglossia)\b/.test(source)) issues.push({ severity: 'error', code: 'browser_engine_incompatible', file: file.path, line: index + 1, message: 'This source requires a Unicode font engine, not pdfLaTeX.', help: 'Explicitly select a reported XeLaTeX or LuaLaTeX profile. Your font declarations are not rewritten.' })
      if (project.engine !== 'lualatex' && /\\(?:setmainfont|setsansfont|setmonofont|newfontfamily|defaultfontfeatures)\b.*\bRenderer\s*=\s*HarfBuzz/i.test(source)) issues.push({ severity: 'error', code: 'browser_engine_incompatible', file: file.path, line: index + 1, message: 'This explicit font declaration requests LuaHBTeX HarfBuzz shaping.', help: 'Choose the supported LuaLaTeX profile explicitly. The renderer request is not dropped or changed to XeTeX shaping.' })
      if (/\\(?:write18|ShellEscape)\b|\\immediate\s*\\write\s*18\b/.test(source)) issues.push({ severity: 'error', code: 'browser_shell_escape_disabled', file: file.path, line: index + 1, message: 'External commands and shell escape are disabled for local compilation.' })
      if (project.engine === 'pdflatex' && /[\u0980-\u09ff]/.test(source)) issues.push({ severity: 'error', code: 'browser_engine_incompatible', file: file.path, line: index + 1, message: 'Unicode Bangla source needs a supported Unicode engine and a bundled Bengali font.' })
    })
  }
  if (!profile.packages.length) issues.push({ severity: 'warning', message: 'No package inventory is available. The real compiler will decide compatibility.' })
  return issues.slice(0, 128)
}

export function browserLatexDiagnostics(log: string, project: LatexProject, refused: boolean): LatexDiagnostic[] {
  const diagnostics: LatexDiagnostic[] = []
  const allowed = new Set(project.files.map((file) => file.path))
  let currentFile: string | undefined
  const stack: (string | undefined)[] = []
  const sourceFile = (value: string) => {
    const path = value.replace(/^"(.*)"$/, '$1').replace(/^(?:\/job\/|\/work\/project\/)/, '').replace(/^(?:\.\/)+/, '')
    try { assertLatexPath(path) } catch { return undefined }
    return allowed.has(path) ? path : undefined
  }
  const sourceLine = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= LATEX_LIMITS.sourceBytes ? Number(value) : undefined
  const location = /^("[^"\n]+"|(?:[A-Za-z]:)?[^\s:]+\.[^\s:./]+|\[sandbox\]):(?!warning:|error:|fatal:)([^\s:]+):\s*(.+)$/iu
  const startsDiagnostic = (value: string) => location.test(value) || /^(?:!|(?:LaTeX(?: Font)?|Package [\w.-]+|Class [\w.-]+) (?:Warning|Error|Info):|Missing character:|(?:Over|Under)full|No file\b|Fatal error\b|Emergency stop\b|(?:ERROR|WARN|FATAL)\s+-)/iu.test(value)
  const add = (item: LatexDiagnostic) => {
    if (diagnostics.some((other) => other.severity === item.severity && other.message === item.message && other.file === item.file && other.line === item.line)) return
    // A warning flood must never hide a later missing glyph or TeX refusal.
    if (diagnostics.length >= 128 && item.severity === 'error') {
      const expendable = diagnostics.findIndex((entry) => entry.severity !== 'error')
      if (expendable >= 0) diagnostics.splice(expendable, 1)
    }
    if (diagnostics.length < 128) diagnostics.push(item)
  }
  const encoded = new TextEncoder().encode(log), lines: string[] = []
  if (encoded.byteLength > LATEX_LIMITS.logBytes) add({ severity: 'error', code: 'log_limit', message: 'The compiler log exceeded its bounded output limit.' })
  let previousWidth = 0
  for (const line of new TextDecoder().decode(encoded.subarray(0, LATEX_LIMITS.logBytes)).split(/\r\n|\n|\r/)) {
    const joined = lines.length ? location.exec(lines.at(-1)! + line) : null
    const continuation = joined && (sourceFile(joined[1]) || /^(?:"?\/|\.\/|\.\.\/)/.test(joined[1]))
    if (lines.length && (previousWidth === 79 || previousWidth >= 2048) && line.trim() && (!startsDiagnostic(line.trimStart()) || continuation) && !/^(?:[()<\\]|l\.)/.test(line.trimStart())) lines[lines.length - 1] += line
    else lines.push(line)
    previousWidth = new TextEncoder().encode(line).byteLength
  }
  let finalPass = 0
  for (let index = 0; index < lines.length; index++) if (/^TeX pass [1-3]: (?:pdfLaTeX|XeLaTeX|LuaLaTeX|LuaHBTeX)\s*$/u.test(lines[index])) finalPass = index
  const warningHeader = /^(?:(?:LaTeX(?: Font)?|Package [\w.-]+|Class [\w.-]+) Warning:|(?:Over|Under)full \\[hv]box|Warning--)/iu
  const infoHeader = /^(?:LaTeX(?: Font)?|Package [\w.-]+|Class [\w.-]+) Info:/iu
  const classified = (message: string, index: number, located = false): Pick<LatexDiagnostic, 'severity' | 'code'> | null => {
    const context = [message, ...lines.slice(index + 1, index + 3)].join('\n')
    if (/^Missing character:/iu.test(message)) {
      if (index < finalPass) return null
      const space = /^Missing character:\s*There is no\s+\(U\+0020\)\s+in font\s+\[SimpleIcons\.otf\][^\n!]*(?:\n[^\n!]*){0,2}!/u.test(context)
      return { severity: space ? 'warning' : 'error', code: space ? 'icon_font_space' : 'missing_glyph' }
    }
    // biblatex probes optional .dbx/.cfg files on every pass. An Info heading
    // is not a required-file failure merely because its text says "not found".
    if (infoHeader.test(message)) return index < finalPass ? null : { severity: 'info', code: 'tex_info' }
    // The fixed output.bbl is generated between TeX passes. Keep its first-pass
    // notice in the log, but still reject missing final output or authored files.
    if (index < finalPass && /^No file output\.bbl\.\s*$/iu.test(message)) return null
    if (/^(?:!\s*)?Font\s+[\s\S]*?\bnot loadable\b/iu.test(message)) return { severity: 'error', code: 'missing_font' }
    // polyglossia reports absent hyphenation patterns as a module warning. The
    // PDF is complete (words are simply not hyphenated), so this stays a
    // visible warning rather than a missing-file refusal of a good proof.
    if (/^Module polyglossia Warning: Hyphenation file \S+ not found/iu.test(message)) return index < finalPass ? null : { severity: 'warning', code: 'tex_warning' }
    if (!(warningHeader.test(message) && index < finalPass) && (/(?:\bfile\b|\bpackage\s+[`'"])[\s\S]*?(?:not found|cannot be found)|(?:cannot|could not|can't|couldn't) (?:open|find) (?:database |style )?file|unable to load (?:picture|image)/iu.test(message)
      || /^No file .+\.(?:tex|sty|cls|bib|bbl|bst|bbx|cbx|png|jpe?g|pdf|eps|svg|otf|ttf|ttc|tfm|woff2?)\./iu.test(message))) {
      const target = /\b(?:file|package)\s+[`'"]([^`'"]+)[`'"]|\bfile\s+([^\s`'"]+)/iu.exec(message)
      const extension = (target?.[1] ?? target?.[2] ?? '').replace(/[.,:;!]+$/, '').split('.').at(-1)?.toLowerCase()
      const code = /^(?:sty|cls)$/.test(extension ?? '') ? 'missing_package' : /^(?:otf|ttf|ttc|tfm|pfb|pfa|woff2?)$/.test(extension ?? '') ? 'missing_font'
        : /^(?:png|jpe?g|pdf|eps|svg|gif|webp|bmp|tiff?)$/.test(extension ?? '') || /unable to load (?:picture|image)/iu.test(message) ? 'missing_asset' : 'missing_file'
      return { severity: 'error', code }
    }
    if (/\bfont\b[\s\S]*?(?:not found|cannot be found|not loadable)/iu.test(message) && (located || /^!|fontspec|^Font |^LaTeX Font Warning:/iu.test(message))) return { severity: 'error', code: 'missing_font' }
    if (warningHeader.test(message)) {
      // Early pass warnings may have converged. They remain in the raw log,
      // but are not final diagnostics or a reason to reject a ready proof.
      if (index < finalPass) return null
      if (/\b(?:Reference|Citation)\s+[^\n]*(?:\n[^\n]*){0,2}\bundefined\b|There were undefined references|Rerun to get cross-references right|Label\(s\) may have changed|Please\s+(?:\(re\))?run\s+(?:LaTeX|Biber)|Please rerun LaTeX|rerunfilecheck Warning:[\s\S]*?has changed/iu.test(context)) return { severity: 'error', code: 'unresolved_references' }
      if (/\bFile\s+[`'"][^`'"\r\n]+\.(?:tex|sty|cls|bib|bst|png|jpe?g|pdf|eps)[`'"][\s\S]*?not found/iu.test(context)) return { severity: 'error', code: 'missing_asset' }
      return { severity: 'warning', code: 'tex_warning' }
    }
    return located ? { severity: 'error', code: 'tex_error' } : null
  }
  let sourceEcho = false
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index], line = raw.trimStart(), located = location.exec(line)
    if (!located && (/^l\.[+-]?[\d.]+(?:\s|$)|^[<\\]/.test(line) || sourceEcho && (!line || /^\s/.test(raw)) && !startsDiagnostic(line))) { sourceEcho = true; continue }
    sourceEcho = false
    if (/^(?:Output written|Transcript written|This is |Here is how|TeX pass [1-3]:)/.test(line)) { currentFile = undefined; stack.length = 0 }
    let message = located ? located[3] : line, file = located ? sourceFile(located[1]) : undefined, number = located ? sourceLine(located[2]) : undefined
    if (startsDiagnostic(line)) {
      while (index + 1 < lines.length && /^(?:\([\w.-]+\)\s+|\s{2,})\S/.test(lines[index + 1]) && !startsDiagnostic(lines[index + 1].trimStart()) && !/^\s*(?:l\.|[<\\)])/.test(lines[index + 1])) message += '\n' + lines[++index].trim()
    }
    const kind = classified(message, index, !!located || /^!/.test(message))
    if (kind) {
      const input = !located ? /\bon input line ([^\s]+?)(?:\.(?=\s|$)|(?=\s|$))/iu.exec(message) : null
      if (input) { file = currentFile; number = sourceLine(input[1]) }
      let help: string | undefined
      if (kind.severity === 'error') {
        let indirect = false
        for (let at = index + 1; at < lines.length; at++) {
          const context = lines[at].trimStart(), echo = /^l\.([+-]?[\d.]+)(?:\s+(.*)|$)/.exec(context)
          if (echo) {
            if (!located && !input) { file = currentFile; number = sourceLine(echo[1]) }
            if (!indirect && /Undefined control sequence/iu.test(message)) {
              const token = /(?:^|[^\\])\\([A-Za-z@]+)\s*$/.exec(echo[2] ?? '')
              if (token) help = `The compiler stopped at \\${token[1]}.`
            }
            index = at; sourceEcho = true; break
          }
          if (startsDiagnostic(context) || /^[()]/.test(context) || /^(?:Output written|Transcript written|This is |TeX pass)/.test(context)) break
          if (/->|^<|^\\/.test(context)) indirect = true
        }
      }
      add({ ...kind, message: message.replace(/^!\s*/, '').slice(0, 4096) || 'TeX refused this source.', ...(file && number ? { file, line: number } : {}), ...(help ? { help } : {}) })
    } else {
      const bibliography = /^(?:\[[^\]\r\n]{1,160}\]\s*(?:[\w.-]+:\d+>\s*)?)?(WARN|ERROR|FATAL)\s+-\s+(.+)/u.exec(line)
      if (bibliography) {
        const missing = /I didn't find a database entry|not found in database/iu.test(bibliography[2])
        add({ severity: bibliography[1] === 'WARN' && !missing ? 'warning' : 'error', message: line.trim().slice(0, 4096), code: missing ? 'unresolved_citation' : 'bibliography_diagnostic' })
        continue
      }
      // Unknown/vendor frames are barriers, never aliases of an outer source.
      for (const token of raw.matchAll(/\((?:"([^"\n]*)"|([^\s()]+))?|(\))/g)) {
        if (token[3]) currentFile = stack.pop()
        else { stack.push(currentFile); currentFile = sourceFile(token[1] ?? token[2] ?? '') }
      }
    }
  }
  if (refused && !diagnostics.some((item) => item.severity === 'error')) add({ severity: 'error', code: 'tex_error', message: 'The real browser TeX engine refused this snapshot. Inspect its local build log; the last good PDF is unchanged.' })
  return diagnostics
}

async function verifyInWorker(data: ArrayBuffer, signal: AbortSignal): Promise<BrowserPdfVerification> {
  if (signal.aborted) throw new DOMException('Local verification cancelled', 'AbortError')
  const worker = new Worker(new URL('./browserPdfVerification.worker.ts', import.meta.url), { type: 'module', name: 'mr-resume-pdf-verification' })
  const abort = () => worker.terminate()
  signal.addEventListener('abort', abort, { once: true })
  try {
    const result = new Promise<BrowserPdfVerification>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (isRecord(data) && data.ok === true && isRecord(data.result)) resolve(data.result as BrowserPdfVerification)
        else reject(new Error(isRecord(data) && typeof data.error === 'string' ? data.error : 'The PDF verifier returned an invalid result.'))
      }
      worker.onerror = (event) => { event.preventDefault(); reject(new Error('The isolated PDF verifier could not run.')) }
      worker.onmessageerror = () => reject(new Error('The PDF verifier returned unreadable data.'))
      const copy = data.slice(0)
      worker.postMessage(copy, [copy])
    })
    return await awaitLatexSignal(result, signal)
  } finally { signal.removeEventListener('abort', abort); worker.terminate() }
}

/** Local-only transport: HTTP is limited to fixed public engine-asset GETs, never project data. */
export function createBrowserLatexTransport(dependencies: Dependencies = {}) {
  const request = dependencies.request ?? fetch
  const assetStore = dependencies.assetStore ?? engineAssetStore
  const manifestPin: EngineAssetPin = { ...BROWSER_LATEX_MANIFEST_PIN, ...dependencies.manifestPin, path: 'manifest.json' }
  const cryptography = () => dependencies.crypto ?? globalThis.crypto
  const supported = dependencies.supported ?? (() => typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && Boolean(cryptography()?.subtle))
  const now = dependencies.now ?? Date.now
  const online = dependencies.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false)
  let manifest: BrowserCompilerManifest | null = null
  let checkingManifest: Promise<void> | null = null
  let active: { operationKey: string; controller: AbortController; terminate: () => void } | null = null
  let clearingCache: Promise<void> | null = null
  let pendingApprovals = 0
  // Only selection evidence, never consent or asset bytes. A changed/forked
  // snapshot cannot inherit an unrelated template's runtime discoveries.
  const dynamicGroups = new Map<string, { snapshot: LatexProject; ids: string[] }>()

  const preparationFailure = (message: string, code = 'browser_package_consent_invalid') => new LatexTransportError({ error: message, code, request_id: 'browser-preparation' })
  const digest = async (data: ArrayBuffer, signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException('Local engine preparation cancelled', 'AbortError')
    if (!cryptography()?.subtle) throw preparationFailure('Secure engine integrity checking requires HTTPS or localhost.', 'browser_runtime_unavailable')
    return Array.from(new Uint8Array(await awaitLatexSignal(cryptography().subtle.digest('SHA-256', data), signal)), (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  const groupHash = (bundle: BrowserCompilerManifest, group: BrowserCompilerGroup, signal?: AbortSignal) => digest(new TextEncoder().encode(JSON.stringify([...group.assets, ...(bundle.biber?.group === group.id ? bundle.biber.assets : [])].sort(compareLatexPaths).map((pin) => [pin.path, pin.bytes, pin.sha256]))).buffer, signal)
  async function consented(bundle: BrowserCompilerManifest, group: BrowserCompilerGroup, signal?: AbortSignal) {
    const hash = await groupHash(bundle, group, signal)
    try { return await awaitLatexSignal(assetStore.hasConsent(bundle.profileVersion, group.id, hash), signal) }
    catch (error) { if (signal?.aborted) throw error; return false }
  }

  async function getBrowserCapabilities(signal?: AbortSignal): Promise<LatexCapabilities> {
    if (signal?.aborted) throw new DOMException('Compiler availability check aborted', 'AbortError')
    if (clearingCache) throw preparationFailure('Wait for engine cache clearing before checking local availability.', 'browser_cache_busy')
    if (!supported()) return { enabled: false, ready: false, reason: 'Local compilation requires WebAssembly, Web Workers and HTTPS or localhost for PDF integrity checking. Editing and retained downloads remain available.', profiles: [], limits: { ...LATEX_LIMITS } }
    if (!manifest) {
      // A caller cancelling its wait must not abort a shared metadata request
      // belonging to another capability/preparation consumer.
      if (!checkingManifest) checkingManifest = checkManifest().finally(() => { checkingManifest = null })
      await awaitLatexSignal(checkingManifest, signal)
    }
    // Revalidate metadata on the first online check; reuse verified metadata offline.
    // ready means available to load, never that TeX has already initialized.
    return { enabled: true, ready: true, reason: 'Browser-local compiler available. The pinned engine and packages load when you compile; source, images, logs and PDF bytes stay on this device.', profiles: manifest!.engines.map((profile) => ({ ...profile, fonts: [...profile.fonts], packages: [...profile.packages] })), limits: { ...LATEX_LIMITS, deadlineSeconds: BROWSER_LATEX_COMPILE_TIMEOUT_MS / 1000 } }
  }

  async function checkManifest(signal?: AbortSignal) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, dependencies.capabilitiesTimeoutMs ?? 15_000)
    const read = async (data: ArrayBuffer) => {
      if (data.byteLength !== manifestPin.bytes || await digest(data, controller.signal) !== manifestPin.sha256) throw new Error('The browser compiler manifest failed its independently pinned SHA-256 integrity check.')
      const bundle = readBrowserCompilerManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)))
      if (bundle.profileVersion !== BROWSER_LATEX_PROFILE_VERSION) throw new Error('The browser compiler manifest does not match the pinned profile version.')
      return bundle
    }
    const cached = async () => {
      try {
        const data = await awaitLatexSignal(assetStore.load(BROWSER_LATEX_PROFILE_VERSION, { ...manifestPin }, controller.signal), controller.signal)
        return data instanceof ArrayBuffer ? await read(data.slice(0)) : null
      } catch (error) { if (controller.signal.aborted) throw error; return null }
    }
    try {
      if (!Number.isSafeInteger(manifestPin.bytes) || manifestPin.bytes < 1 || manifestPin.bytes > 1024 * 1024 || !/^[0-9a-f]{64}$/.test(manifestPin.sha256)) throw new Error('The application manifest pin is invalid.')
      if (!online()) { const bundle = await cached(); if (bundle) { manifest = bundle; return } }
      let response: Response
      try {
        response = await awaitLatexSignal(request(`${BROWSER_LATEX_ROOT}manifest.json?profile=${BROWSER_LATEX_PROFILE_VERSION}`, { method: 'GET', mode: 'same-origin', credentials: 'omit', redirect: 'error', cache: online() ? 'no-cache' : 'force-cache', signal: controller.signal }), controller.signal)
      } catch (error) {
        // A network miss may reuse exact application-pinned metadata. Invalid
        // online metadata is never silently replaced with an older manifest.
        if (controller.signal.aborted) throw error
        const bundle = await cached()
        if (bundle) { manifest = bundle; return }
        throw error
      }
      if (!response.ok || response.redirected || !/^application\/json\b/i.test(response.headers.get('content-type') ?? '')) {
        if (response.body) void response.body.cancel().catch(() => {})
        throw new Error('The browser compiler assets are unavailable. First use requires a same-origin engine download; offline use needs cached assets.')
      }
      const bytes = await readBoundedLatexBytes(response, manifestPin.bytes, controller.signal)
      const bundle = await read(bytes)
      manifest = bundle
      try { await awaitLatexSignal(assetStore.save(bundle.profileVersion, { ...manifestPin }, bytes.slice(0), controller.signal), controller.signal) }
      catch (error) { if (controller.signal.aborted) throw error }
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted) throw new Error('The fixed browser engine manifest check timed out. Source and retained PDFs are unchanged; retry explicitly when assets are reachable.')
      throw error
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }

  async function prepare(project: LatexProject, bundle: BrowserCompilerManifest, signal?: AbortSignal, explicitGroups: readonly string[] = []) {
    if (signal?.aborted) throw new DOMException('Local engine preparation cancelled', 'AbortError')
    if (!packageGroupClosure(bundle.groups ?? [], project.engine, explicitGroups)) throw preparationFailure('The selected package groups are unknown, duplicated or incompatible with this engine.')
    const required = referencedBrowserSources(project, bundle.engines.find((profile) => profile.id === project.engine)), groups: BrowserCompilerGroup[] = [], approvedGroups: string[] = []
    const filenames = (group: BrowserCompilerGroup) => group.files ?? group.packages.flatMap((name) => [`${name}.sty`, `${name}.cls`])
    const base = (bundle.groups ?? []).filter((group) => group.kind !== 'package' && group.profiles.includes(project.engine))
    const provided = new Set(base.flatMap(filenames))
    const discovered = (bundle.groups ?? []).filter((group) => group.kind === 'package' && group.profiles.includes(project.engine) && filenames(group).some((name) => required.has(name) && !provided.has(name)
      // A physical .sty/.cls is not necessarily a qualified package export.
      && (!/\.(?:sty|cls)$/i.test(name) || group.packages.includes(name.replace(/\.(?:sty|cls)$/i, ''))))).map((group) => group.id)
    const remembered = dynamicGroups.get(project.id)
    const previous = remembered && remembered.snapshot.revision === project.revision && sameProjectSource(remembered.snapshot, project) ? remembered.ids : []
    const selected = packageGroupClosure(bundle.groups ?? [], project.engine, [...new Set([...explicitGroups, ...previous, ...discovered, ...base.flatMap((group) => group.requires ?? [])])])
    if (!selected) throw preparationFailure('The selected browser package dependency closure is invalid.')
    for (const group of selected) {
      if (await consented(bundle, group, signal)) approvedGroups.push(group.id)
      else groups.push(group)
    }
    return { preparation: preparationFor(bundle, groups), approvedGroups }
  }

  async function getBrowserPreparation(project: LatexProject, signal?: AbortSignal): Promise<BrowserPreparation> {
    if (signal?.aborted) throw new DOMException('Local engine preparation cancelled', 'AbortError')
    validateLatexProject(project)
    if (project.mainFile === null) throw preparationFailure(LATEX_MAIN_FILE_NOTICE, 'missing_main')
    const snapshot = { ...project, files: project.files.map((file) => ({ ...file })), assets: project.assets.map((asset) => ({ ...asset })) }
    if (!manifest) await getBrowserCapabilities(signal)
    if (!manifest) throw preparationFailure('The secure browser compiler is unavailable.', 'browser_runtime_unavailable')
    return (await prepare(snapshot, manifest, signal)).preparation
  }

  async function approveBrowserPackageGroups(preparation: BrowserPreparation, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new DOMException('Local package approval cancelled', 'AbortError')
    if (clearingCache) throw preparationFailure('Engine cache clearing is in progress. Wait before approving package downloads.', 'browser_cache_busy')
    pendingApprovals++
    try {
      if (!manifest) await getBrowserCapabilities(signal)
      const bundle = manifest
      if (!bundle || !isRecord(preparation) || preparation.profileVersion !== bundle.profileVersion || !Array.isArray(preparation.groups) || !preparation.groups.length || preparation.groups.length > 29
        || new Set(preparation.groups.map((group) => isRecord(group) && group.id)).size !== preparation.groups.length) throw preparationFailure('The package approval no longer matches the current pinned engine manifest.')
      const identity = (group: BrowserCompilerGroup) => JSON.stringify({ ...copyGroup(group), profiles: [...group.profiles].sort(), packages: [...group.packages].sort(), assets: [...group.assets].sort(compareLatexPaths),
        ...(group.files ? { files: [...group.files].sort() } : {}), ...(group.requires ? { requires: [...group.requires].sort() } : {}) })
      const groups = preparation.groups.map((supplied) => {
        const group = bundle.groups?.find((group) => isRecord(supplied) && group.id === supplied.id && group.kind === 'package')
        if (!group) throw preparationFailure('Only known pinned package groups can be approved.')
        try {
          const checked = readBrowserCompilerManifest({ ...bundle, groups: bundle.groups!.map((item) => item.id === group.id ? supplied : item) }).groups!.find((item) => item.id === group.id)!
          if (identity(checked) !== identity(group)) throw new Error('Changed package group')
        } catch { throw preparationFailure('The package approval contains altered group metadata or asset pins.') }
        return group
      })
      if (!Number.isSafeInteger(preparation.downloadBytes) || preparation.downloadBytes !== preparationFor(bundle, groups).downloadBytes) throw preparationFailure('The package approval has an incorrect pinned download size.')
      for (const group of groups) {
        const hash = await groupHash(bundle, group, signal)
        await awaitLatexSignal(assetStore.consent(bundle.profileVersion, group.id, hash), signal)
        if (!await consented(bundle, group, signal)) throw preparationFailure('Package consent could not be stored. No package was fetched; engine cache storage may be unavailable or full.', 'browser_package_consent_unavailable')
      }
    } finally { pendingApprovals-- }
  }

  async function loadAsset(bundle: BrowserCompilerManifest, pin: EngineAssetPin, signal: AbortSignal, bytes: { downloadedBytes: number; verifiedBytes: number; totalBytes: number; cachedBytes: number; assetPath?: string; assetAudit: LatexEngineAssetAudit[] }, notify: (value: LatexCompileProgress) => void): Promise<ArrayBuffer> {
    bytes.assetPath = pin.path
    const biber = bundle.biber
    const group = bundle.groups?.find((group) => group.assets.some((asset) => asset.path === pin.path) || (biber && group.id === biber.group && biber.assets.some((asset) => asset.path === pin.path)))
    const audit = (source: LatexEngineAssetAudit['source']): LatexEngineAssetAudit => ({
      ...pin, source,
      groupId: group?.id ?? (bundle.groups ? 'runtime' : 'engine-bundle'),
      groupKind: group?.kind ?? (bundle.groups ? 'runtime' : 'bundle'),
      packages: [...(group?.packages ?? [])],
    })
    let cached: ArrayBuffer | null = null
    try { cached = await awaitLatexSignal(assetStore.load(bundle.profileVersion, { ...pin }, signal), signal) }
    catch (error) { if (signal.aborted) throw error }
    if (cached instanceof ArrayBuffer && cached.byteLength === pin.bytes) {
      const data = cached.slice(0)
      if (await digest(data, signal) === pin.sha256) {
        bytes.cachedBytes += data.byteLength; bytes.verifiedBytes += data.byteLength
        bytes.assetAudit = [...bytes.assetAudit, audit('indexeddb-reuse')]
        notify({ phase: 'loading', message: 'Verified a cached public engine asset. No source is uploaded.' })
        return data
      }
    }
    const response = await awaitLatexSignal(request(`${BROWSER_LATEX_ROOT}${pin.path}?sha256=${pin.sha256}`, { method: 'GET', mode: 'same-origin', credentials: 'omit', redirect: 'error', cache: 'force-cache', signal }), signal)
    if (!response.ok || response.redirected || (pin.path === 'compiler-worker.js' && !/^(?:application|text)\/javascript\b/i.test(response.headers.get('content-type') ?? ''))) {
      if (response.body) void response.body.cancel().catch(() => {})
      throw new Error('A pinned local compiler asset is unavailable or has an invalid worker MIME type. Offline use requires every selected asset to be cached.')
    }
    const declared = response.headers.get('content-length'), encoding = response.headers.get('content-encoding')?.trim().toLowerCase()
    // Fetch exposes decoded bytes; encoded Content-Length describes wire bytes,
    // which can differ from the immutable asset's pinned byte size.
    const identityEncoding = !encoding || encoding === 'identity'
    if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || (identityEncoding && Number(declared) > pin.bytes))) {
      if (response.body) void response.body.cancel().catch(() => {})
      throw new Error('A compiler asset exceeded its pinned byte limit or declared an invalid length.')
    }
    const reader = response.body?.getReader(), data = new Uint8Array(pin.bytes)
    let length = 0, complete = !reader
    try {
      if (reader) {
        while (true) {
          const part = await awaitLatexSignal(reader.read(), signal)
          if (part.done) { complete = true; break }
          if (length + part.value.byteLength > pin.bytes) throw new Error('A compiler asset exceeded its pinned byte limit.')
          data.set(part.value, length); length += part.value.byteLength; bytes.downloadedBytes += part.value.byteLength
          notify({ phase: 'loading', message: 'Reading a fixed same-origin engine asset response. Source stays on this device.' })
        }
      } else {
        const content = new Uint8Array(await awaitLatexSignal(response.arrayBuffer(), signal))
        length = content.byteLength
        if (length > pin.bytes) throw new Error('A compiler asset exceeded its pinned byte limit.')
        data.set(content); bytes.downloadedBytes += length
        notify({ phase: 'loading', message: 'Read the fixed same-origin asset response. Transfer provenance may include the HTTP cache.' })
      }
    } finally {
      if (reader) { if (!complete) void reader.cancel().catch(() => {}); reader.releaseLock() }
    }
    if (length !== pin.bytes || (declared !== null && identityEncoding && Number(declared) !== length)) throw new Error('A compiler asset did not match its pinned or declared byte size.')
    if (await digest(data.buffer, signal) !== pin.sha256) throw new Error('A compiler asset failed its pinned SHA-256 byte-integrity check.')
    bytes.verifiedBytes += length
    bytes.assetAudit = [...bytes.assetAudit, audit('fetch-response')]
    notify({ phase: 'loading', message: 'Verified the public engine response bytes against their pinned SHA-256.' })
    // Even an injected cache cannot mutate bytes which will execute in the worker.
    try { await awaitLatexSignal(assetStore.save(bundle.profileVersion, { ...pin }, data.buffer.slice(0), signal), signal) }
    catch (error) { if (signal.aborted) throw error }
    return data.buffer
  }

  async function compileBrowserProject(project: LatexProject, operationKey: string, signal?: AbortSignal, progress?: (value: LatexCompileProgress) => void, options: BrowserCompileOptions = {}): Promise<LatexProof> {
    const requestId = `browser-${operationKey}`
    const fail = (error: string, code: string, diagnostics: LatexDiagnostic[] = [], log = '') => new LatexTransportError({ error, code, request_id: requestId, operationKey, diagnostics, log })
    if (active) throw fail('A browser compile is already running. Cancel it or queue the latest source in the editor.', 'browser_compiler_busy')
    if (clearingCache) throw fail('Engine cache clearing is in progress. Wait before compiling locally.', 'browser_cache_busy')
    readLatexId(operationKey, 8)
    validateLatexProject(project)
    if (project.mainFile === null) throw fail(LATEX_MAIN_FILE_NOTICE, 'missing_main')
    // Capture everything before any await. Blob bytes are immutable; source arrays are not.
    const snapshot = { ...project, files: project.files.map((file) => ({ ...file })), assets: project.assets.map((asset) => ({ ...asset })) }
    if (options.packageGroups !== undefined && (!Array.isArray(options.packageGroups) || options.packageGroups.length > 29 || new Set(options.packageGroups).size !== options.packageGroups.length)) throw fail('The reviewed package selection is invalid.', 'browser_package_consent_invalid')
    const packageGroups = [...(options.packageGroups ?? [])], { onSyncArtifact, mayStartAfterPreparation } = options
    const input = readLatexManifest({ version: snapshot.version, operationKey, projectId: snapshot.id, title: snapshot.title, revision: snapshot.revision, mainFile: snapshot.mainFile, engine: snapshot.engine,
      files: snapshot.files, assets: snapshot.assets.map((asset) => ({ id: asset.id, path: asset.path, mediaType: asset.mediaType, size: asset.blob.size })) })
    for (const file of [...snapshot.files, ...snapshot.assets]) assertLatexPath(file.path)
    const controller = new AbortController()
    let worker: BrowserCompilerWorker | undefined
    let workerUrl: string | undefined
    let terminated = false
    let compilationStarted = false
    let phase: 'loading' | 'compiling' | 'verifying' = 'loading'
    let timedOut: 'loading' | 'compiling' | undefined
    const terminate = () => { if (worker && !terminated) { terminated = true; worker.terminate() } }
    const slot = { operationKey, controller, terminate }
    active = slot
    const abort = () => { terminate(); controller.abort() }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    let timer = setTimeout(() => { timedOut = 'loading'; abort() }, dependencies.loadingTimeoutMs ?? 300_000)
    let byteProgress: { downloadedBytes: number; verifiedBytes: number; totalBytes: number; cachedBytes: number; assetPath?: string; assetAudit: LatexEngineAssetAudit[] } | undefined
    let buildContext: LatexCompileProgress['buildContext']
    const notify = (value: LatexCompileProgress) => { if (!controller.signal.aborted) progress?.({ ...value, ...byteProgress,
      ...(buildContext ? { buildContext: { ...buildContext, manifest: { ...buildContext.manifest }, profile: { ...buildContext.profile, fonts: [...buildContext.profile.fonts], packages: [...buildContext.profile.packages] } } } : {}) }) }
    const hash = (data: ArrayBuffer) => digest(data, controller.signal)
    try {
      if (controller.signal.aborted) throw new DOMException('Local compile cancelled', 'AbortError')
      if (!supported() || !cryptography()?.subtle) throw fail('This browser cannot compile and verify a PDF securely. Use HTTPS or localhost.', 'browser_runtime_unavailable')
      notify({ phase: 'loading', message: 'Checking the pinned local engine bundle. No source is uploaded.' })
      if (!manifest) await getBrowserCapabilities(controller.signal)
      const bundle = manifest!
      const capturedProfile = bundle.engines.find((profile) => profile.id === snapshot.engine)
      if (capturedProfile) buildContext = { profileVersion: bundle.profileVersion, manifest: { ...manifestPin },
        profile: { ...capturedProfile, fonts: [...capturedProfile.fonts], packages: [...capturedProfile.packages] } }
      const compatibility = browserLatexCompatibility(snapshot, bundle.engines)
      if (compatibility.some((item) => item.severity === 'error')) throw fail('This source is incompatible with the selected local engine. Review Problems; no source was rewritten or uploaded.', 'browser_compile_incompatible', compatibility)
      if (packageGroups.length && !browserPackagePreparation(bundle, snapshot.engine, packageGroups)) throw fail('The reviewed package groups are unknown or incompatible with this engine.', 'browser_package_consent_invalid')
      let selection = await prepare(snapshot, bundle, controller.signal, packageGroups)
      if (selection.preparation.groups.length) throw new BrowserPackageGroupRequiredError(selection.preparation, operationKey)
      const assets = []
      const files: { path: string; content: string | Uint8Array }[] = snapshot.files.map(({ path, content }) => ({ path, content }))
      for (const asset of snapshot.assets) {
        const data = await awaitLatexSignal(asset.blob.arrayBuffer(), controller.signal)
        assets.push({ id: asset.id, path: asset.path, mediaType: asset.mediaType, size: data.byteLength, sha256: await hash(data) })
        files.push({ path: asset.path, content: new Uint8Array(data) })
      }
      const snapshotHash = await hash(new TextEncoder().encode(JSON.stringify({ version: input.version, projectId: input.projectId, revision: input.revision, mainFile: input.mainFile, engine: input.engine,
        files: [...input.files].sort(compareLatexPaths), assets: assets.sort(compareLatexPaths) })).buffer)
      let compiled: { pdf: ArrayBuffer; log: string; synctex?: ArrayBuffer; synctexPdfSha256?: string } | undefined
      let syncParser: ArrayBuffer | undefined
      byteProgress = { downloadedBytes: 0, verifiedBytes: 0, totalBytes: 0, cachedBytes: 0, assetAudit: [] }
      for (let attempt = 0; attempt <= (bundle.groups?.length ?? 0); attempt++) {
        const { approvedGroups } = selection, pins = browserEngineAssetPins(bundle, snapshot.engine, approvedGroups)
        phase = 'loading'
        // Transferred buffers are gone. Re-read/reverify selected pins for each
        // fresh worker; cumulative progress includes those real repeated reads.
        byteProgress.totalBytes += pins.reduce((sum, pin) => sum + pin.bytes, 0)
        notify({ phase: 'loading', message: attempt ? 'Reloading the selected engine with newly required, previously approved package pins.' : 'Loading only the selected pinned engine and approved packages.' })
        const engineAssets: { path: string; content: ArrayBuffer }[] = []
        for (const pin of pins) engineAssets.push({ path: pin.path, content: await loadAsset(bundle, pin, controller.signal, byteProgress, notify) })
        if (mayStartAfterPreparation && !mayStartAfterPreparation()) { abort(); throw new DOMException('The package retry source changed', 'AbortError') }
        if (!syncParser && onSyncArtifact && bundle.synctex) syncParser = engineAssets.find((asset) => asset.path === bundle.synctex!.path)?.content.slice(0)
        if (dependencies.createWorker) worker = dependencies.createWorker()
        else {
          // Execute the very same parent-verified bytes, then transfer them for the
          // worker's independent hash check. Blob construction preserves its copy.
          const code = engineAssets.find((asset) => asset.path === 'compiler-worker.js')!.content
          workerUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
          worker = new Worker(workerUrl, { name: 'mr-resume-local-tex' })
        }
        terminated = false
        const output = new Promise<NonNullable<typeof compiled> | { requiredGroups: string[]; log: string }>((resolve, reject) => {
          let initialized = false, completed = false
          const protocol = () => { completed = true; reject(fail('The local compiler returned an invalid or mismatched result. No PDF was accepted.', 'browser_protocol_error')) }
          worker!.onerror = (event) => { event.preventDefault(); completed = true; reject(fail('The browser TeX worker could not run. Its roughly 512 MiB WASM reserve needs additional file and verification memory. Close other tabs and retry explicitly, or select the private native runtime with upload consent. Source and the last good PDF are unchanged.', 'browser_worker_failed')) }
          worker!.onmessageerror = () => protocol()
          worker!.onmessage = ({ data }: MessageEvent<unknown>) => {
            if (completed || controller.signal.aborted) return
            if (!isRecord(data)) { protocol(); return }
            if (data.type === 'progress') {
              if (!['loading', 'initializing', 'compiling'].includes(String(data.stage))) return
              const pass = Number.isSafeInteger(data.pass) && (data.pass as number) >= 1 && (data.pass as number) <= 3 ? data.pass as number : undefined
              notify({ phase: data.stage as LatexCompileProgress['phase'], message: data.stage === 'loading' ? 'Loading the same-origin TeX engine and package bundle. Source stays on this device.' : data.stage === 'initializing' ? 'Initializing the isolated browser TeX runtime.' : pass ? `Running ${snapshot.engine} locally, TeX pass ${pass}. You can keep editing.` : data.message === 'Running the real local Biber 2.22 bibliography pass.' ? 'Running Biber locally to build the original publications and citations.' : 'Running the local TeX toolchain on this captured source. You can keep editing.', ...(pass ? { pass } : {}) })
            } else if (data.type === 'ready') {
              if (initialized || data.version !== bundle.profileVersion || !Array.isArray(data.engines) || data.engines.length !== bundle.engines.length || new Set(data.engines).size !== data.engines.length
                || data.engines.some((id) => !bundle.engines.some((profile) => profile.id === id)) || !data.engines.includes(snapshot.engine)) { protocol(); return }
              if (mayStartAfterPreparation && !mayStartAfterPreparation()) { abort(); return }
              initialized = true
              phase = 'compiling'
              if (!compilationStarted) {
                compilationStarted = true
                clearTimeout(timer)
                timer = setTimeout(() => { timedOut = 'compiling'; abort() }, dependencies.compileTimeoutMs ?? BROWSER_LATEX_COMPILE_TIMEOUT_MS)
              }
              notify({ phase: 'compiling', message: `Running ${snapshot.engine} on the captured source snapshot, entirely on this device.` })
              try { worker!.postMessage({ type: 'compile', operationKey, engine: snapshot.engine, mainFile: snapshot.mainFile, files }) } catch { protocol() }
            } else if (data.type === 'error') {
              completed = true
              const log = typeof data.log === 'string' ? data.log : ''
              if (new TextEncoder().encode(log).byteLength > LATEX_LIMITS.logBytes || (initialized && data.operationKey !== operationKey)) { protocol(); return }
              if (data.code === 'package_group_required') {
                if (!initialized || !Array.isArray(data.groupIDs) || !browserPackagePreparation(bundle, snapshot.engine, data.groupIDs) || data.groupIDs.some((id) => approvedGroups.includes(id))) { protocol(); return }
                resolve({ requiredGroups: [...data.groupIDs] as string[], log }); return
              }
              const diagnostics = initialized ? browserLatexDiagnostics(log, snapshot, true) : [{ severity: 'error' as const, code: 'browser_runtime_unavailable', message: 'The pinned browser engine failed before receiving a source snapshot.', help: typeof data.message === 'string' ? data.message.slice(0, 2048) : 'Check same-origin assets, cache availability and device memory.' }]
              reject(fail(initialized ? 'The real local TeX engine refused this snapshot. Your previous PDF and source are unchanged.' : 'The local engine bundle could not initialize. Its roughly 512 MiB WASM reserve needs additional file and verification memory. Check the fixed assets, close other tabs and retry explicitly, or select the private native runtime with upload consent. No source was uploaded; the last good PDF is unchanged.', initialized ? 'browser_tex_error' : 'browser_runtime_unavailable', diagnostics, log))
            } else if (data.type === 'result') {
              completed = true
              if (!initialized || data.operationKey !== operationKey || data.engine !== snapshot.engine || data.exitCode !== 0 || !(data.pdf instanceof ArrayBuffer) || typeof data.log !== 'string'
                || data.pdf.byteLength > LATEX_LIMITS.pdfBytes || new TextEncoder().encode(data.log).byteLength > LATEX_LIMITS.logBytes
                || (Object.hasOwn(data, 'synctex') && (!(data.synctex instanceof ArrayBuffer) || data.synctex.byteLength < 1 || data.synctex.byteLength > LATEX_LIMITS.syncBytes || typeof data.synctexPdfSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.synctexPdfSha256)))) { protocol(); return }
              resolve({ pdf: data.pdf, log: data.log, ...(data.synctex instanceof ArrayBuffer ? { synctex: data.synctex, synctexPdfSha256: data.synctexPdfSha256 as string } : {}) })
            } else protocol()
          }
          worker!.postMessage({ type: 'init', mainFile: snapshot.mainFile, engine: snapshot.engine, manifest: readBrowserCompilerManifest(bundle), assets: engineAssets, approvedGroups }, engineAssets.map((asset) => asset.content))
        })
        const received = await awaitLatexSignal(output, controller.signal)
        terminate()
        if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = undefined }
        if (!('requiredGroups' in received)) { compiled = received; break }
        if (mayStartAfterPreparation && !mayStartAfterPreparation()) { abort(); throw new DOMException('The package retry source changed', 'AbortError') }
        dynamicGroups.delete(snapshot.id)
        dynamicGroups.set(snapshot.id, { snapshot, ids: [...new Set([...approvedGroups, ...received.requiredGroups])] })
        if (dynamicGroups.size > 8) dynamicGroups.delete(dynamicGroups.keys().next().value!)
        selection = await prepare(snapshot, bundle, controller.signal, packageGroups)
        if (selection.preparation.groups.length) throw new BrowserPackageGroupRequiredError(selection.preparation, operationKey, received.log)
        if (selection.approvedGroups.length <= approvedGroups.length) throw fail('The compiler requested a package group that was already installed. No repeated download or compile was attempted.', 'browser_protocol_error', [], received.log)
      }
      if (!compiled) throw fail('The browser compiler exceeded its bounded package discovery attempts.', 'browser_protocol_error')
      const { pdf, log, synctex, synctexPdfSha256 } = compiled
      const diagnostics = browserLatexDiagnostics(log, snapshot, false)
      if (diagnostics.some((item) => item.severity === 'error')) throw fail('The compiler reported lost glyphs or TeX errors. No incomplete PDF replaced your previous proof.', 'browser_compile_refused', diagnostics, log)
      phase = 'verifying'
      notify({ phase: 'verifying', message: 'Verifying the real PDF structure, page count and original-byte SHA-256 before accepting a proof.' })
      const verified = await awaitLatexSignal((dependencies.verifyPdf ?? verifyInWorker)(pdf.slice(0), controller.signal), controller.signal)
      if (verified.bytes !== pdf.byteLength || !Number.isSafeInteger(verified.pages) || verified.pages < 1 || verified.pages > LATEX_LIMITS.pages || verified.sha256 !== await hash(pdf)) throw fail('The local PDF failed its independent original-byte integrity check.', 'browser_pdf_invalid', diagnostics, log)
      const result = readLatexCompileResult({ status: 'ready', operationKey, projectId: input.projectId, revision: input.revision, snapshotHash, engine: input.engine, profileVersion: bundle.profileVersion,
        pdf: { id: operationKey, sha256: verified.sha256, bytes: verified.bytes, pages: verified.pages }, diagnostics, log, syncAvailable: false, createdAt: new Date(now()).toISOString() }, input)
      const proof: LatexProof = { ...result, runtime: 'browser', data: pdf }
      if (synctex && syncParser && bundle.synctex && onSyncArtifact) {
        if (synctexPdfSha256 !== verified.sha256) throw fail('The source map is not bound to the verified final PDF.', 'browser_protocol_error', diagnostics, log)
        const artifact: BrowserSyncArtifact = { identity: proofActionIdentity(proof), engine: snapshot.engine, data: synctex, parser: syncParser, parserSha256: bundle.synctex.sha256,
          sourceFiles: snapshot.files.map((file) => ({ path: file.path, lines: file.content.split(/\r\n|\r|\n/u).length })) }
        if (await awaitLatexSignal((dependencies.inspectSyncArtifact ?? inspectBrowserSyncArtifact)(proof, artifact, controller.signal), controller.signal)) onSyncArtifact(artifact)
      }
      return proof
    } catch (error) {
      if (timedOut) throw fail(timedOut === 'loading' ? 'The browser engine download/initialization exceeded its deadline. Cache the fixed assets online and try explicitly again.' : 'The local compile/verification exceeded its bounded deadline. The worker was terminated; the previous PDF and source are unchanged.', `browser_${timedOut}_timeout`)
      if (controller.signal.aborted) throw fail('Local compilation cancelled. Its worker was terminated; source and the previous PDF are unchanged.', 'browser_compile_cancelled')
      if (error instanceof LatexTransportError) throw error
      throw fail(error instanceof Error ? error.message : 'The local compiler or PDF verification failed.', phase === 'loading' ? 'browser_runtime_unavailable' : 'browser_pdf_invalid')
    } finally {
      clearTimeout(timer)
      terminate()
      if (workerUrl) URL.revokeObjectURL(workerUrl)
      signal?.removeEventListener('abort', abort)
      if (active === slot) active = null
    }
  }

  async function cancelBrowserCompile(operationKey: string) {
    if (!active || active.operationKey !== operationKey) return { cancelled: false, status: 'not_found' }
    active.terminate()
    active.controller.abort()
    return { cancelled: true, status: 'cancelled' }
  }
  const getBrowserEngineCacheSummary = (): Promise<EngineCacheSummary> => assetStore.summary()
  function clearBrowserEngineCache(): Promise<void> {
    if (active || checkingManifest || pendingApprovals) return Promise.reject(preparationFailure('Wait for engine preparation or cancel the current local compile before clearing its cache.', 'browser_cache_busy'))
    if (!clearingCache) clearingCache = assetStore.clear().finally(() => { clearingCache = null })
    return clearingCache
  }
  return { getBrowserCapabilities, getBrowserPreparation, approveBrowserPackageGroups, getBrowserEngineCacheSummary, clearBrowserEngineCache, compileBrowserProject, cancelBrowserCompile, getManifest: () => manifest && readBrowserCompilerManifest(manifest) }
}

// Importing does not instantiate a worker, fetch an asset, or start compilation.
const browserTransport = createBrowserLatexTransport()
export const getBrowserCapabilities = browserTransport.getBrowserCapabilities
export const getBrowserPreparation = browserTransport.getBrowserPreparation
export const approveBrowserPackageGroups = browserTransport.approveBrowserPackageGroups
export const getBrowserEngineCacheSummary = browserTransport.getBrowserEngineCacheSummary
export const clearBrowserEngineCache = browserTransport.clearBrowserEngineCache
export const compileBrowserProject = browserTransport.compileBrowserProject
export const cancelBrowserCompile = browserTransport.cancelBrowserCompile
export const getBrowserCompilerManifest = browserTransport.getManifest
