import { LATEX_LIMITS, LATEX_MAIN_FILE_NOTICE, type LatexCapabilities, type LatexDiagnostic, type LatexEngine, type LatexProfile, type LatexProject, type LatexProof } from './types.ts'
import { assertLatexPath, isRecord, validateLatexProject } from './project.ts'
import { awaitLatexSignal, compareLatexPaths, readBoundedLatexBytes, readLatexCapabilities, readLatexCompileResult, readLatexId, readLatexManifest } from './server/contract.ts'
import { LatexTransportError } from './compileTransport.ts'
import type { BrowserPdfVerification } from './browserPdfVerification.ts'
import { engineAssetStore, type EngineAssetPin, type EngineAssetStore, type EngineCacheSummary } from './engineAssetStore.ts'
import { BROWSER_LATEX_MANIFEST_PIN } from './browserManifestPin.ts'

export const BROWSER_LATEX_ROOT = '/mr-resume/latex/busytex-v1/'
export const BROWSER_LATEX_PROFILE_VERSION = 'browser-busytex-v1-tl2023-4499aa69-r5'
export type BrowserCompilerGroup = {
  id: string
  kind: 'core' | 'profile' | 'package'
  profiles: LatexEngine[]
  packages: string[]
  archive: string
  index: string
  assets: EngineAssetPin[]
}
export type BrowserPreparation = { profileVersion: string; groups: BrowserCompilerGroup[]; downloadBytes: number }
export type BrowserCompilerManifest = {
  version: 1
  profileVersion: string
  engines: LatexProfile[]
  assets: EngineAssetPin[]
  groups?: BrowserCompilerGroup[]
  limitations: string[]
}
export type LatexCompileProgress = { phase: 'loading' | 'initializing' | 'compiling' | 'verifying'; message: string; pass?: number; downloadedBytes?: number; verifiedBytes?: number; totalBytes?: number; cachedBytes?: number; assetPath?: string }
export type BrowserCompilerWorker = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null
  postMessage: { (message: unknown): void; (message: unknown, transfer: Transferable[]): void }
  terminate: () => void
}
type Dependencies = {
  request?: (url: string, init: RequestInit) => Promise<Response>
  createWorker?: () => BrowserCompilerWorker
  verifyPdf?: (data: ArrayBuffer, signal: AbortSignal) => Promise<BrowserPdfVerification>
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
    groups = input.groups.map((value) => {
      if (!isRecord(value) || Object.keys(value).length !== 7 || Object.keys(value).some((key) => !['id', 'kind', 'profiles', 'packages', 'archive', 'index', 'assets'].includes(key))
        || typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.id) || ids.has(value.id) || typeof value.kind !== 'string' || !['core', 'profile', 'package'].includes(value.kind)
        || !Array.isArray(value.profiles) || !value.profiles.length || value.profiles.length > 3 || new Set(value.profiles).size !== value.profiles.length || value.profiles.some((id) => !capabilities.profiles.some((profile) => profile.id === id))
        || !Array.isArray(value.packages) || value.packages.length > 128 || value.packages.some((name) => typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name))
        || new Set(value.packages.map((name: string) => name.toLowerCase())).size !== value.packages.length || (value.kind === 'package' && !value.packages.length)
        || typeof value.archive !== 'string' || !value.archive.startsWith(`groups/${value.id}/`) || !value.archive.endsWith('.tar.gz')
        || typeof value.index !== 'string' || !value.index.startsWith(`groups/${value.id}/`) || !value.index.endsWith('.json') || !Array.isArray(value.assets) || value.assets.length !== 2) throw new Error('The browser compiler has an invalid package or profile group.')
      ids.add(value.id)
      const assets = value.assets.map(pin)
      if (!assets.every((asset) => asset.path === value.archive || asset.path === value.index) || !assets.some((asset) => asset.path === value.archive) || !assets.some((asset) => asset.path === value.index)
        || (value.kind === 'package' && assets.find((asset) => asset.path === value.archive)!.bytes > 12 * 1024 * 1024)) throw new Error('A browser compiler group has unlisted or oversized assets.')
      return { id: value.id, kind: value.kind as BrowserCompilerGroup['kind'], profiles: [...value.profiles] as LatexEngine[], packages: [...value.packages] as string[], archive: value.archive, index: value.index, assets }
    })
    if (!groups.some((group) => group.kind === 'core') || capabilities.profiles.some((profile) => !groups!.some((group) => group.kind === 'profile' && group.profiles.includes(profile.id)))) throw new Error('The grouped compiler is missing its core or an advertised engine profile.')
  }
  return { version: 1, profileVersion: input.profileVersion, engines: capabilities.profiles, assets, ...(groups ? { groups } : {}), limitations: [...input.limitations] as string[] }
}

const copyGroup = (group: BrowserCompilerGroup): BrowserCompilerGroup => ({ ...group, profiles: [...group.profiles], packages: [...group.packages], assets: group.assets.map((pin) => ({ ...pin })) })
const preparationFor = (bundle: BrowserCompilerManifest, groups: BrowserCompilerGroup[]): BrowserPreparation => ({ profileVersion: bundle.profileVersion, groups: groups.map(copyGroup).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), downloadBytes: groups.reduce((sum, group) => sum + group.assets.reduce((bytes, pin) => bytes + pin.bytes, 0), 0) })

/** Public byte inventory only; presence or consent is not a claim of an offline-ready engine. */
export function browserEngineAssetPins(bundle: BrowserCompilerManifest, engine: LatexEngine, approvedGroups: readonly string[] = []): EngineAssetPin[] {
  const groups = bundle.groups?.filter((group) => group.kind === 'core' || (group.kind === 'profile' && group.profiles.includes(engine)) || (group.kind === 'package' && group.profiles.includes(engine) && approvedGroups.includes(group.id)))
  return (groups ? [...bundle.assets.filter((pin) => ['compiler-worker.js', 'busytex.js.bin', 'busytex.wasm'].includes(pin.path)), ...groups.flatMap((group) => group.assets)] : bundle.assets).map((pin) => ({ ...pin }))
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
function referencedBrowserSources(project: LatexProject) {
  const files: LatexProject['files'] = [], packages = new Set<string>(), visited = new Set<string>()
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
    visited.add(file.path); files.push(file)
    const source = withoutTexComments(file.content), directory = file.path.slice(0, file.path.lastIndexOf('/') + 1)
    for (const match of source.matchAll(/(?<!\\)\\(usepackage|RequirePackage(?:WithOptions)?|documentclass|LoadClass(?:WithOptions)?|input|include)\b\s*(?:\[[^\]]*\]\s*)?(?:\{([^{}]*)\}|([^\s{}%\\]+))/g)) {
      const command = match[1], input = command === 'input' || command === 'include', extension = input ? '.tex' : /class|Class/.test(command) ? '.cls' : '.sty'
      for (const value of (match[2] ?? (input ? match[3] : '') ?? '').split(',')) {
        const literal = value.trim()
        if (!literal || /[\s\\{}%#\[\]:]/.test(literal) || literal.startsWith('/')) continue
        const path = /\.[A-Za-z0-9]+$/.test(literal) ? literal : literal + extension
        const candidates = [path, mainDirectory + path, directory + path].map(normalize)
        const dependency = candidates.map((path) => project.files.find((item) => item.path === path)).find(Boolean)
        if (dependency) pending.push(dependency)
        else if (!input || /\.(?:sty|cls)$/i.test(path)) packages.add(literal.slice(literal.lastIndexOf('/') + 1).replace(/\.(?:sty|cls)$/i, ''))
      }
    }
  }
  return { files, packages }
}

/** A source review is best effort, not a claim to statically understand arbitrary TeX macros. */
export function browserLatexCompatibility(project: LatexProject, profiles: readonly LatexProfile[]): LatexDiagnostic[] {
  if (!profiles.some((profile) => profile.id === project.engine)) return [{ severity: 'error', code: 'browser_engine_unsupported', message: 'The selected engine is not included in this browser bundle.', help: 'Choose an engine shown in browser settings, or explicitly select the private native runtime. Source is never converted to another engine silently.' }]
  const issues: LatexDiagnostic[] = []
  const profile = profiles.find((item) => item.id === project.engine)!
  // Unused archive/source files are not a preamble. Included classes/packages
  // may contain inactive engine branches; the real engine decides those.
  for (const file of project.files.filter((item) => item.path === project.mainFile)) {
    file.content.split(/\r\n|\n|\r/).forEach((line, index) => {
      // An escaped percent is source, not the start of a comment.
      const source = withoutTexComments(line)
      if (/\\(?:usepackage|RequirePackage)(?:\s*\[[^\]]*\])?\s*\{[^}]*\bbiblatex\b/.test(source)) issues.push({ severity: 'error', code: 'browser_biber_unsupported', file: file.path, line: index + 1, message: 'The local bundle does not implement the biblatex/Biber workflow.', help: 'Keep this source unchanged and use the private native runtime. A classic BibTeX document is a different workflow, not a silent substitute.' })
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
  const add = (item: LatexDiagnostic) => {
    if (diagnostics.some((other) => other.severity === item.severity && other.message === item.message && other.file === item.file && other.line === item.line)) return
    // A warning flood must never hide a later missing glyph or TeX refusal.
    if (diagnostics.length >= 128 && item.severity === 'error') {
      const expendable = diagnostics.findIndex((entry) => entry.severity !== 'error')
      if (expendable >= 0) diagnostics.splice(expendable, 1)
    }
    if (diagnostics.length < 128) diagnostics.push(item)
  }
  const lines = log.split(/\r\n|\n|\r/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const opening = /\((?:\/[^\s()]*\/)?([^\s()]+\.(?:tex|sty|cls))/.exec(line)
    if (opening && allowed.has(opening[1])) currentFile = opening[1]
    const located = /^([^\s:]+\.(?:tex|sty|cls)):(\d+):\s*(.+)$/.exec(line)
    if (located) {
      const reported = located[1].replace(/^\.\//, '')
      const path = allowed.has(reported) ? reported : [...allowed].find((path) => ['/work/', '/job/', '/workspace/'].some((prefix) => reported === `${prefix}${path}`))
      if (path) { add({ severity: 'error', file: path, line: Number(located[2]), message: located[3].slice(0, 4096), code: 'tex_error' }); continue }
    }
    if (line.startsWith('!')) {
      const following = lines.slice(index + 1, index + 9).find((entry) => /^l\.\d+\s/.test(entry))
      const number = following ? Number(/^l\.(\d+)/.exec(following)![1]) : undefined
      add({ severity: 'error', message: line.slice(1).trim().slice(0, 4096) || 'TeX refused this source.', code: /not found/i.test(line) ? 'missing_package' : 'tex_error', ...(currentFile ? { file: currentFile, ...(number ? { line: number } : {}) } : {}) })
    } else if (/Missing character:|LaTeX Font Warning|(?:LaTeX|Package [\w-]+) Warning:|(?:Over|Under)full \\[hv]box/.test(line)) {
      add({ severity: /Missing character:/.test(line) ? 'error' : 'warning', message: line.trim().slice(0, 4096), code: /Missing character:/.test(line) ? 'missing_glyph' : 'tex_warning' })
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

  const preparationFailure = (message: string, code = 'browser_package_consent_invalid') => new LatexTransportError({ error: message, code, request_id: 'browser-preparation' })
  const digest = async (data: ArrayBuffer, signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException('Local engine preparation cancelled', 'AbortError')
    if (!cryptography()?.subtle) throw preparationFailure('Secure engine integrity checking requires HTTPS or localhost.', 'browser_runtime_unavailable')
    return Array.from(new Uint8Array(await awaitLatexSignal(cryptography().subtle.digest('SHA-256', data), signal)), (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  const groupHash = (group: BrowserCompilerGroup, signal?: AbortSignal) => digest(new TextEncoder().encode(JSON.stringify([...group.assets].sort(compareLatexPaths).map((pin) => [pin.path, pin.bytes, pin.sha256]))).buffer, signal)
  async function consented(bundle: BrowserCompilerManifest, group: BrowserCompilerGroup, signal?: AbortSignal) {
    const hash = await groupHash(group, signal)
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
    return { enabled: true, ready: true, reason: 'Browser-local compiler available. The pinned engine and packages load when you compile; source, images, logs and PDF bytes stay on this device.', profiles: manifest!.engines.map((profile) => ({ ...profile, fonts: [...profile.fonts], packages: [...profile.packages] })), limits: { ...LATEX_LIMITS } }
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

  async function prepare(project: LatexProject, bundle: BrowserCompilerManifest, signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException('Local engine preparation cancelled', 'AbortError')
    const required = referencedBrowserSources(project).packages, groups: BrowserCompilerGroup[] = [], approvedGroups: string[] = []
    for (const group of bundle.groups ?? []) {
      if (group.kind !== 'package' || !group.profiles.includes(project.engine)) continue
      if (await consented(bundle, group, signal)) approvedGroups.push(group.id)
      else if (group.packages.some((name) => required.has(name))) groups.push(group)
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
      const identity = (group: BrowserCompilerGroup) => JSON.stringify({ ...copyGroup(group), profiles: [...group.profiles].sort(), packages: [...group.packages].sort(), assets: [...group.assets].sort(compareLatexPaths) })
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
        const hash = await groupHash(group, signal)
        await awaitLatexSignal(assetStore.consent(bundle.profileVersion, group.id, hash), signal)
        if (!await consented(bundle, group, signal)) throw preparationFailure('Package consent could not be stored. No package was fetched; engine cache storage may be unavailable or full.', 'browser_package_consent_unavailable')
      }
    } finally { pendingApprovals-- }
  }

  async function loadAsset(bundle: BrowserCompilerManifest, pin: EngineAssetPin, signal: AbortSignal, bytes: { downloadedBytes: number; verifiedBytes: number; totalBytes: number; cachedBytes: number; assetPath?: string }, notify: (value: LatexCompileProgress) => void): Promise<ArrayBuffer> {
    bytes.assetPath = pin.path
    let cached: ArrayBuffer | null = null
    try { cached = await awaitLatexSignal(assetStore.load(bundle.profileVersion, { ...pin }, signal), signal) }
    catch (error) { if (signal.aborted) throw error }
    if (cached instanceof ArrayBuffer && cached.byteLength === pin.bytes) {
      const data = cached.slice(0)
      if (await digest(data, signal) === pin.sha256) {
        bytes.cachedBytes += data.byteLength; bytes.verifiedBytes += data.byteLength
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
    notify({ phase: 'loading', message: 'Verified the public engine response bytes against their pinned SHA-256.' })
    // Even an injected cache cannot mutate bytes which will execute in the worker.
    try { await awaitLatexSignal(assetStore.save(bundle.profileVersion, { ...pin }, data.buffer.slice(0), signal), signal) }
    catch (error) { if (signal.aborted) throw error }
    return data.buffer
  }

  async function compileBrowserProject(project: LatexProject, operationKey: string, signal?: AbortSignal, progress?: (value: LatexCompileProgress) => void): Promise<LatexProof> {
    const requestId = `browser-${operationKey}`
    const fail = (error: string, code: string, diagnostics: LatexDiagnostic[] = [], log = '') => new LatexTransportError({ error, code, request_id: requestId, operationKey, diagnostics, log })
    if (active) throw fail('A browser compile is already running. Cancel it or queue the latest source in the editor.', 'browser_compiler_busy')
    if (clearingCache) throw fail('Engine cache clearing is in progress. Wait before compiling locally.', 'browser_cache_busy')
    readLatexId(operationKey, 8)
    validateLatexProject(project)
    if (project.mainFile === null) throw fail(LATEX_MAIN_FILE_NOTICE, 'missing_main')
    // Capture everything before any await. Blob bytes are immutable; source arrays are not.
    const snapshot = { ...project, files: project.files.map((file) => ({ ...file })), assets: project.assets.map((asset) => ({ ...asset })) }
    const input = readLatexManifest({ version: snapshot.version, operationKey, projectId: snapshot.id, title: snapshot.title, revision: snapshot.revision, mainFile: snapshot.mainFile, engine: snapshot.engine,
      files: snapshot.files, assets: snapshot.assets.map((asset) => ({ id: asset.id, path: asset.path, mediaType: asset.mediaType, size: asset.blob.size })) })
    for (const file of [...snapshot.files, ...snapshot.assets]) assertLatexPath(file.path)
    const controller = new AbortController()
    let worker: BrowserCompilerWorker | undefined
    let workerUrl: string | undefined
    let terminated = false
    let phase: 'loading' | 'compiling' | 'verifying' = 'loading'
    let timedOut: 'loading' | 'compiling' | undefined
    const terminate = () => { if (worker && !terminated) { terminated = true; worker.terminate() } }
    const slot = { operationKey, controller, terminate }
    active = slot
    const abort = () => { terminate(); controller.abort() }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    let timer = setTimeout(() => { timedOut = 'loading'; abort() }, dependencies.loadingTimeoutMs ?? 300_000)
    let byteProgress: { downloadedBytes: number; verifiedBytes: number; totalBytes: number; cachedBytes: number; assetPath?: string } | undefined
    const notify = (value: LatexCompileProgress) => { if (!controller.signal.aborted) progress?.({ ...value, ...byteProgress }) }
    const hash = (data: ArrayBuffer) => digest(data, controller.signal)
    try {
      if (controller.signal.aborted) throw new DOMException('Local compile cancelled', 'AbortError')
      if (!supported() || !cryptography()?.subtle) throw fail('This browser cannot compile and verify a PDF securely. Use HTTPS or localhost.', 'browser_runtime_unavailable')
      notify({ phase: 'loading', message: 'Checking the pinned local engine bundle. No source is uploaded.' })
      if (!manifest) await getBrowserCapabilities(controller.signal)
      const bundle = manifest!
      const compatibility = browserLatexCompatibility(snapshot, bundle.engines)
      if (compatibility.some((item) => item.severity === 'error')) throw fail('This source is incompatible with the selected local engine. Review Problems; no source was rewritten or uploaded.', 'browser_compile_incompatible', compatibility)
      const { preparation, approvedGroups } = await prepare(snapshot, bundle, controller.signal)
      if (preparation.groups.length) throw new BrowserPackageGroupRequiredError(preparation, operationKey)
      const pins = browserEngineAssetPins(bundle, snapshot.engine, approvedGroups)
      byteProgress = { downloadedBytes: 0, verifiedBytes: 0, totalBytes: pins.reduce((sum, pin) => sum + pin.bytes, 0), cachedBytes: 0 }
      notify({ phase: 'loading', message: 'Loading only the selected pinned engine and approved packages.' })
      const engineAssets: { path: string; content: ArrayBuffer }[] = []
      for (const pin of pins) engineAssets.push({ path: pin.path, content: await loadAsset(bundle, pin, controller.signal, byteProgress, notify) })
      const assets = []
      const files: { path: string; content: string | Uint8Array }[] = snapshot.files.map(({ path, content }) => ({ path, content }))
      for (const asset of snapshot.assets) {
        const data = await awaitLatexSignal(asset.blob.arrayBuffer(), controller.signal)
        assets.push({ id: asset.id, path: asset.path, mediaType: asset.mediaType, size: data.byteLength, sha256: await hash(data) })
        files.push({ path: asset.path, content: new Uint8Array(data) })
      }
      const snapshotHash = await hash(new TextEncoder().encode(JSON.stringify({ version: input.version, projectId: input.projectId, revision: input.revision, mainFile: input.mainFile, engine: input.engine,
        files: [...input.files].sort(compareLatexPaths), assets: assets.sort(compareLatexPaths) })).buffer)
      if (dependencies.createWorker) worker = dependencies.createWorker()
      else {
        // Execute the very same parent-verified bytes, then transfer them for the
        // worker's independent hash check. Blob construction preserves its copy.
        const code = engineAssets.find((asset) => asset.path === 'compiler-worker.js')!.content
        workerUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
        worker = new Worker(workerUrl, { name: 'mr-resume-local-tex' })
      }
      const output = new Promise<{ pdf: ArrayBuffer; log: string }>((resolve, reject) => {
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
            notify({ phase: data.stage as LatexCompileProgress['phase'], message: data.stage === 'loading' ? 'Loading the same-origin TeX engine and package bundle. Source stays on this device.' : data.stage === 'initializing' ? 'Initializing the isolated browser TeX runtime.' : pass ? `Running ${snapshot.engine} locally, TeX pass ${pass}. You can keep editing.` : 'Running the local TeX toolchain on this captured source. You can keep editing.', ...(pass ? { pass } : {}) })
          } else if (data.type === 'ready') {
            if (initialized || data.version !== bundle.profileVersion || !Array.isArray(data.engines) || data.engines.length !== bundle.engines.length || new Set(data.engines).size !== data.engines.length
              || data.engines.some((id) => !bundle.engines.some((profile) => profile.id === id)) || !data.engines.includes(snapshot.engine)) { protocol(); return }
            initialized = true
            phase = 'compiling'
            clearTimeout(timer)
            timer = setTimeout(() => { timedOut = 'compiling'; abort() }, dependencies.compileTimeoutMs ?? LATEX_LIMITS.deadlineSeconds * 1000)
            notify({ phase: 'compiling', message: `Running ${snapshot.engine} on the captured source snapshot, entirely on this device.` })
            try { worker!.postMessage({ type: 'compile', operationKey, engine: snapshot.engine, mainFile: snapshot.mainFile, files }) } catch { protocol() }
          } else if (data.type === 'error') {
            completed = true
            const log = typeof data.log === 'string' ? data.log : ''
            if (new TextEncoder().encode(log).byteLength > LATEX_LIMITS.logBytes || (initialized && data.operationKey !== operationKey)) { protocol(); return }
            if (data.code === 'package_group_required') {
              if (!initialized || !Array.isArray(data.groupIDs) || !data.groupIDs.length || data.groupIDs.length > 29 || new Set(data.groupIDs).size !== data.groupIDs.length) { protocol(); return }
              const required = data.groupIDs.map((id) => bundle.groups?.find((group) => group.id === id && group.kind === 'package' && group.profiles.includes(snapshot.engine) && !approvedGroups.includes(group.id)))
              if (required.some((group) => !group)) { protocol(); return }
              reject(new BrowserPackageGroupRequiredError(preparationFor(bundle, required as BrowserCompilerGroup[]), operationKey, log)); return
            }
            const diagnostics = initialized ? browserLatexDiagnostics(log, snapshot, true) : [{ severity: 'error' as const, code: 'browser_runtime_unavailable', message: 'The pinned browser engine failed before receiving a source snapshot.', help: typeof data.message === 'string' ? data.message.slice(0, 2048) : 'Check same-origin assets, cache availability and device memory.' }]
            reject(fail(initialized ? 'The real local TeX engine refused this snapshot. Your previous PDF and source are unchanged.' : 'The local engine bundle could not initialize. Its roughly 512 MiB WASM reserve needs additional file and verification memory. Check the fixed assets, close other tabs and retry explicitly, or select the private native runtime with upload consent. No source was uploaded; the last good PDF is unchanged.', initialized ? 'browser_tex_error' : 'browser_runtime_unavailable', diagnostics, log))
          } else if (data.type === 'result') {
            completed = true
            if (!initialized || data.operationKey !== operationKey || data.engine !== snapshot.engine || data.exitCode !== 0 || !(data.pdf instanceof ArrayBuffer) || typeof data.log !== 'string'
              || data.pdf.byteLength > LATEX_LIMITS.pdfBytes || new TextEncoder().encode(data.log).byteLength > LATEX_LIMITS.logBytes) { protocol(); return }
            resolve({ pdf: data.pdf, log: data.log })
          } else protocol()
        }
        worker!.postMessage({ type: 'init', mainFile: snapshot.mainFile, engine: snapshot.engine, manifest: readBrowserCompilerManifest(bundle), assets: engineAssets, approvedGroups }, engineAssets.map((asset) => asset.content))
      })
      const { pdf, log } = await awaitLatexSignal(output, controller.signal)
      terminate()
      const diagnostics = browserLatexDiagnostics(log, snapshot, false)
      if (diagnostics.some((item) => item.severity === 'error')) throw fail('The compiler reported lost glyphs or TeX errors. No incomplete PDF replaced your previous proof.', 'browser_compile_refused', diagnostics, log)
      phase = 'verifying'
      notify({ phase: 'verifying', message: 'Verifying the real PDF structure, page count and original-byte SHA-256 before accepting a proof.' })
      const verified = await awaitLatexSignal((dependencies.verifyPdf ?? verifyInWorker)(pdf.slice(0), controller.signal), controller.signal)
      if (verified.bytes !== pdf.byteLength || !Number.isSafeInteger(verified.pages) || verified.pages < 1 || verified.pages > LATEX_LIMITS.pages || verified.sha256 !== await hash(pdf)) throw fail('The local PDF failed its independent original-byte integrity check.', 'browser_pdf_invalid', diagnostics, log)
      const result = readLatexCompileResult({ status: 'ready', operationKey, projectId: input.projectId, revision: input.revision, snapshotHash, engine: input.engine, profileVersion: bundle.profileVersion,
        pdf: { id: operationKey, sha256: verified.sha256, bytes: verified.bytes, pages: verified.pages }, diagnostics, log, syncAvailable: false, createdAt: new Date(now()).toISOString() }, input)
      return { ...result, runtime: 'browser', data: pdf }
    } catch (error) {
      if (timedOut) throw fail(timedOut === 'loading' ? 'The browser engine download/initialization exceeded its deadline. Cache the fixed assets online and try explicitly again.' : 'The local compile/verification exceeded its 30-second deadline. The worker was terminated; the previous PDF and source are unchanged.', `browser_${timedOut}_timeout`)
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
