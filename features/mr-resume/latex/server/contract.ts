/** Public DTO/byte validation only. No identity, environment, or native document logic belongs here. */
import {
  LATEX_LIMITS, LATEX_PROJECT_VERSION,
  type LatexCapabilities, type LatexCompileFailure, type LatexCompileManifest, type LatexCompileResult,
  type LatexDiagnostic, type LatexEngine, type LatexOperation, type LatexSyncQuery, type LatexSyncResult,
} from '../types.ts'

export const LATEX_JSON_BYTES = 1024 * 1024
export const LATEX_SMALL_REQUEST_BYTES = 16 * 1024
export const LATEX_HASH_PATTERN = /^[0-9a-f]{64}$/
const ENGINES = new Set(['lualatex', 'xelatex', 'pdflatex'])
const SOURCE_PATH = /\.(tex|sty|cls|bib|bst)$/i
const encoder = new TextEncoder()

export class LatexContractError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code = 'invalid_manifest', status = 400) {
    super(message)
    this.name = 'LatexContractError'
    this.code = code
    this.status = status
  }
}

function requireValue(condition: unknown, message: string, code = 'invalid_manifest', status = 400): asserts condition {
  if (!condition) throw new LatexContractError(message, code, status)
}

function record(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected an object')
  const result = value as Record<string, unknown>
  requireValue(required.every((key) => Object.hasOwn(result, key)) && Object.keys(result).every((key) => required.includes(key) || optional.includes(key)), 'Unexpected or missing fields')
  return result
}

export function isWellFormedLatexText(value: string) {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false
  }
  return true
}

function text(value: unknown, maxBytes: number, blank = true): string {
  requireValue(typeof value === 'string', 'Invalid text value')
  requireValue(value.length <= maxBytes, 'Text exceeds its byte limit', 'payload_too_large', 413)
  requireValue(isWellFormedLatexText(value), 'Invalid Unicode text value')
  requireValue(encoder.encode(value).byteLength <= maxBytes, 'Text exceeds its byte limit', 'payload_too_large', 413)
  requireValue(blank || value.trim().length > 0, 'A required text value is empty')
  return value
}

function integer(value: unknown, minimum: number, maximum: number): number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'Invalid integer value')
  return value
}

function coordinate(value: unknown): number {
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 14_400, 'Invalid PDF coordinate')
  return value
}

export function readLatexId(value: unknown, minimum = 1): string {
  requireValue(typeof value === 'string' && value.length >= minimum && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value), 'Invalid private operation or file identifier', 'invalid_identifier')
  return value
}

export function isSafeLatexPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 240
    && isWellFormedLatexText(value) && encoder.encode(value).byteLength <= 240
    && value === value.normalize('NFC') && /^[\p{L}\p{M}\p{N}_./-]+$/u.test(value) && !value.startsWith('/')
    && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && !part.endsWith('.'))
}

function path(value: unknown, source = false): string {
  requireValue(isSafeLatexPath(value), 'Unsafe or non-canonical project path', 'invalid_path')
  requireValue(!source || SOURCE_PATH.test(value), 'Unsupported source file extension', 'unsupported_file_type', 415)
  return value
}

function engine(value: unknown): LatexEngine {
  requireValue(typeof value === 'string' && ENGINES.has(value), 'Unsupported LaTeX engine', 'invalid_engine')
  return value as LatexEngine
}

function hash(value: unknown): string {
  requireValue(typeof value === 'string' && LATEX_HASH_PATTERN.test(value), 'Invalid SHA-256 hash')
  return value
}

export function readLatexManifest(value: unknown): LatexCompileManifest {
  const input = record(value, ['version', 'operationKey', 'projectId', 'title', 'revision', 'mainFile', 'engine', 'files', 'assets'])
  requireValue(input.version === LATEX_PROJECT_VERSION, 'Unsupported LaTeX project version')
  requireValue(Array.isArray(input.files) && input.files.length > 0 && Array.isArray(input.assets) && input.files.length + input.assets.length <= LATEX_LIMITS.files, `A project supports at most ${LATEX_LIMITS.files} source files and assets`, 'file_limit_exceeded')
  const ids = new Set<string>()
  const paths = new Set<string>()
  const unique = (id: string, filePath: string) => {
    const alias = filePath.toLowerCase()
    requireValue(!ids.has(id) && !paths.has(alias), 'Duplicate file identifier or path alias', 'duplicate_file')
    ids.add(id)
    paths.add(alias)
  }
  let sourceBytes = 0
  const files = input.files.map((item) => {
    const file = record(item, ['id', 'path', 'content'])
    const id = readLatexId(file.id)
    const filePath = path(file.path, true)
    const content = text(file.content, LATEX_LIMITS.sourceBytes)
    sourceBytes += encoder.encode(content).byteLength
    unique(id, filePath)
    return { id, path: filePath, content }
  })
  requireValue(sourceBytes <= LATEX_LIMITS.sourceBytes, 'Source text exceeds the 1 MiB limit', 'source_too_large', 413)
  let assetBytes = 0
  const assets = input.assets.map((item) => {
    const asset = record(item, ['id', 'path', 'mediaType', 'size'])
    const id = readLatexId(asset.id)
    const filePath = path(asset.path)
    requireValue((asset.mediaType === 'image/png' && /\.png$/i.test(filePath)) || (asset.mediaType === 'image/jpeg' && /\.(jpg|jpeg)$/i.test(filePath)), 'Only PNG and JPEG assets are supported', 'unsupported_file_type', 415)
    const size = integer(asset.size, 1, LATEX_LIMITS.uploadBytes)
    assetBytes += size
    unique(id, filePath)
    return { id, path: filePath, mediaType: asset.mediaType as 'image/png' | 'image/jpeg', size }
  })
  requireValue(assetBytes + sourceBytes <= LATEX_LIMITS.uploadBytes, 'Project exceeds the transported byte limit', 'payload_too_large', 413)
  const mainFile = path(input.mainFile, true)
  requireValue(/\.tex$/i.test(mainFile) && files.some((file) => file.path === mainFile), 'The main file must be a source .tex file in this manifest', 'invalid_main_file')
  return {
    version: LATEX_PROJECT_VERSION, operationKey: readLatexId(input.operationKey, 8), projectId: readLatexId(input.projectId),
    title: text(input.title, 512), revision: integer(input.revision, 0, Number.MAX_SAFE_INTEGER), mainFile,
    engine: engine(input.engine), files, assets,
  }
}

export function readLatexDiagnostics(value: unknown, allowedPaths?: ReadonlySet<string>): LatexDiagnostic[] {
  requireValue(Array.isArray(value) && value.length <= 128, 'Invalid or excessive diagnostics')
  return value.map((item) => {
    const input = record(item, ['severity', 'message'], ['file', 'line', 'code', 'help'])
    requireValue(input.severity === 'error' || input.severity === 'warning' || input.severity === 'info', 'Invalid diagnostic severity')
    const result: LatexDiagnostic = { severity: input.severity, message: text(input.message, 4096, false) }
    if (input.file !== undefined) {
      result.file = path(input.file)
      requireValue(!allowedPaths || allowedPaths.has(result.file), 'A diagnostic refers to a file outside this snapshot')
    }
    if (input.line !== undefined) result.line = integer(input.line, 1, LATEX_LIMITS.sourceBytes)
    if (input.code !== undefined) result.code = text(input.code, 128, false)
    if (input.help !== undefined) result.help = text(input.help, 4096)
    return result
  })
}

export function readLatexCompileResult(value: unknown, expected?: LatexCompileManifest): LatexCompileResult {
  const input = record(value, ['status', 'operationKey', 'projectId', 'revision', 'snapshotHash', 'engine', 'profileVersion', 'pdf', 'diagnostics', 'log', 'syncAvailable', 'createdAt'])
  requireValue(input.status === 'ready' && typeof input.syncAvailable === 'boolean', 'Invalid compile result status')
  const pdf = record(input.pdf, ['id', 'sha256', 'bytes', 'pages'])
  const createdAt = text(input.createdAt, 64, false)
  requireValue(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt) && Number.isFinite(Date.parse(createdAt)), 'Invalid artifact timestamp')
  const result: LatexCompileResult = {
    status: 'ready', operationKey: readLatexId(input.operationKey, 8), projectId: readLatexId(input.projectId),
    revision: integer(input.revision, 0, Number.MAX_SAFE_INTEGER), snapshotHash: hash(input.snapshotHash), engine: engine(input.engine),
    profileVersion: text(input.profileVersion, 256, false),
    pdf: { id: readLatexId(pdf.id), sha256: hash(pdf.sha256), bytes: integer(pdf.bytes, 1, LATEX_LIMITS.pdfBytes), pages: integer(pdf.pages, 1, LATEX_LIMITS.pages) },
    diagnostics: readLatexDiagnostics(input.diagnostics, expected && new Set([...expected.files, ...expected.assets].map((file) => file.path))),
    log: text(input.log, LATEX_LIMITS.logBytes), syncAvailable: input.syncAvailable, createdAt,
  }
  if (expected) requireValue(result.operationKey === expected.operationKey && result.projectId === expected.projectId && result.revision === expected.revision && result.engine === expected.engine, 'The compiler result does not match the submitted snapshot', 'result_mismatch', 502)
  return result
}

export function readLatexFailure(value: unknown, allowedPaths?: ReadonlySet<string>): LatexCompileFailure {
  const input = record(value, ['error', 'code', 'request_id'], ['operationKey', 'diagnostics', 'log'])
  requireValue(typeof input.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(input.code), 'Invalid failure code')
  const result: LatexCompileFailure = { error: text(input.error, 2048, false), code: input.code, request_id: readLatexId(input.request_id) }
  if (input.operationKey !== undefined) result.operationKey = readLatexId(input.operationKey, 8)
  if (input.diagnostics !== undefined) result.diagnostics = readLatexDiagnostics(input.diagnostics, allowedPaths)
  if (input.log !== undefined) result.log = text(input.log, LATEX_LIMITS.logBytes)
  return result
}

export function readLatexCapabilities(value: unknown): LatexCapabilities {
  const input = record(value, ['enabled', 'ready', 'reason', 'profiles', 'limits'])
  requireValue(typeof input.enabled === 'boolean' && typeof input.ready === 'boolean' && (!input.ready || input.enabled), 'Invalid compiler availability')
  requireValue(Array.isArray(input.profiles) && input.profiles.length <= 3 && (!input.ready || input.profiles.length > 0), 'Invalid compiler profiles')
  const limits = record(input.limits, Object.keys(LATEX_LIMITS))
  const validatedLimits = Object.fromEntries((Object.keys(LATEX_LIMITS) as (keyof typeof LATEX_LIMITS)[]).map((key) => [key, integer(limits[key], 1, LATEX_LIMITS[key])])) as LatexCapabilities['limits']
  const ids = new Set<string>()
  const list = (value: unknown) => {
    requireValue(Array.isArray(value) && value.length <= 256, 'Invalid profile requirements')
    return value.map((item) => text(item, 256, false))
  }
  const profiles = input.profiles.map((item) => {
    const profile = record(item, ['id', 'name', 'version', 'fonts', 'packages'])
    const id = engine(profile.id)
    requireValue(!ids.has(id), 'Duplicate compiler profile')
    ids.add(id)
    return { id, name: text(profile.name, 256, false), version: text(profile.version, 256, false), fonts: list(profile.fonts), packages: list(profile.packages) }
  })
  return { enabled: input.enabled, ready: input.ready, reason: text(input.reason, 2048), profiles, limits: validatedLimits }
}

export function readLatexCancelResult(value: unknown): { cancelled: boolean; status: string } {
  const input = record(value, ['cancelled', 'status'])
  requireValue(typeof input.cancelled === 'boolean' && typeof input.status === 'string' && ['cancelled', 'running', 'cancelling', 'ready', 'failed', 'not_found'].includes(input.status), 'Invalid cancellation response')
  requireValue(input.cancelled === (input.status === 'cancelled'), 'Cancellation was not acknowledged consistently')
  return { cancelled: input.cancelled, status: input.status }
}

export function readLatexOperation(value: unknown, operationKey: string): LatexOperation {
  if (value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).status === 'ready') {
    const result = readLatexCompileResult(value)
    requireValue(result.operationKey === operationKey, 'Recovery returned a different operation', 'result_mismatch', 502)
    return result
  }
  const input = record(value, ['status', 'operationKey'], ['error'])
  requireValue(input.status === 'running' || input.status === 'cancelled' || input.status === 'failed', 'Invalid operation status')
  requireValue(readLatexId(input.operationKey, 8) === operationKey, 'Recovery returned a different operation', 'result_mismatch', 502)
  return { status: input.status, operationKey, ...(input.error === undefined ? {} : { error: text(input.error, 2048, false) }) }
}

export function readLatexSyncQuery(value: unknown): LatexSyncQuery {
  const forward = value && typeof value === 'object' && (value as Record<string, unknown>).direction === 'forward'
  const input = record(value, ['operationKey', 'snapshotHash', 'pdfHash', 'direction', ...(forward ? ['file', 'line'] : ['page', 'x', 'y'])])
  const common = { operationKey: readLatexId(input.operationKey, 8), snapshotHash: hash(input.snapshotHash), pdfHash: hash(input.pdfHash) }
  if (input.direction === 'forward') return { ...common, direction: 'forward', file: path(input.file, true), line: integer(input.line, 1, LATEX_LIMITS.sourceBytes) }
  requireValue(input.direction === 'inverse', 'Invalid synchronization direction')
  return { ...common, direction: 'inverse', page: integer(input.page, 1, LATEX_LIMITS.pages), x: coordinate(input.x), y: coordinate(input.y) }
}

export function readLatexSyncResult(value: unknown, query: LatexSyncQuery): LatexSyncResult {
  const input = record(value, ['available', 'locations'], ['file', 'line'])
  requireValue(typeof input.available === 'boolean' && Array.isArray(input.locations) && input.locations.length <= 256, 'Invalid synchronization result')
  const result: LatexSyncResult = { available: input.available, locations: input.locations.map((item) => {
    const location = record(item, ['page', 'x', 'y', 'width', 'height'])
    return { page: integer(location.page, 1, LATEX_LIMITS.pages), x: coordinate(location.x), y: coordinate(location.y), width: coordinate(location.width), height: coordinate(location.height) }
  }) }
  if (input.file !== undefined) result.file = path(input.file, true)
  if (input.line !== undefined) result.line = integer(input.line, 1, LATEX_LIMITS.sourceBytes)
  requireValue(result.available || (!result.locations.length && result.file === undefined && result.line === undefined), 'Unavailable synchronization contains a guessed mapping')
  if (result.available && query.direction === 'forward') requireValue(result.locations.length > 0 && (result.file === undefined || result.file === query.file), 'Forward synchronization does not match its source')
  if (result.available && query.direction === 'inverse') requireValue(result.file !== undefined && result.line !== undefined, 'Inverse synchronization is missing its source location')
  return result
}

export async function awaitLatexSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  let abort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new DOMException('Stopped waiting for the private compiler', 'AbortError'))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([promise, aborted]) }
  finally { if (abort) signal.removeEventListener('abort', abort) }
}

export async function readBoundedLatexBytes(body: Request | Response, maximum: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (signal?.aborted) throw new DOMException('Stopped waiting for the private compiler', 'AbortError')
  const declared = body.headers.get('content-length')
  let length: number | undefined
  if (declared !== null) {
    requireValue(/^\d+$/.test(declared) && Number.isSafeInteger(Number(declared)), 'Invalid body length', 'invalid_body_length')
    length = Number(declared)
    requireValue(length <= maximum, 'Body exceeds its transported byte limit', 'payload_too_large', 413)
  }
  const reader = body.body?.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let complete = !reader
  try {
    if (signal?.aborted) throw new DOMException('Stopped waiting for the private compiler', 'AbortError')
    if (reader) {
      while (true) {
        const { value, done } = await awaitLatexSignal(reader.read(), signal)
        if (done) { complete = true; break }
        total += value.byteLength
        requireValue(total <= maximum, 'Body exceeds its transported byte limit', 'payload_too_large', 413)
        chunks.push(value)
      }
    }
    // Fetch may expose compressed Content-Length while its body is already decoded.
    const encoding = body.headers.get('content-encoding')?.toLowerCase()
    requireValue(length === undefined || (encoding && encoding !== 'identity') || length === total, 'Declared and observed body lengths differ', 'body_length_mismatch')
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return bytes.buffer
  } finally {
    if (reader) {
      if (!complete) void reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
}

export function compareLatexPaths(left: { path: string }, right: { path: string }): number {
  const a = Array.from(left.path, (character) => character.codePointAt(0)!)
  const b = Array.from(right.path, (character) => character.codePointAt(0)!)
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index] - b[index]
  return a.length - b.length
}
