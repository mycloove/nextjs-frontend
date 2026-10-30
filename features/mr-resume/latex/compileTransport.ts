import {
  LATEX_API, LATEX_LIMITS, type LatexCapabilities, type LatexCompileFailure, type LatexCompileManifest,
  type LatexOperation, type LatexProject, type LatexProof, type LatexSyncQuery, type LatexSyncResult,
} from './types.ts'
import {
  awaitLatexSignal, compareLatexPaths, LATEX_JSON_BYTES, LatexContractError,
  readBoundedLatexBytes, readLatexCancelResult, readLatexCapabilities, readLatexCompileResult, readLatexFailure,
  readLatexId, readLatexManifest, readLatexOperation, readLatexSyncQuery, readLatexSyncResult,
} from './server/contract.ts'

export class LatexTransportError extends Error implements LatexCompileFailure {
  readonly error: string
  readonly code: string
  readonly request_id: string
  readonly operationKey?: string
  readonly diagnostics?: LatexCompileFailure['diagnostics']
  readonly log?: string
  readonly status?: number
  readonly retryAfterSeconds?: number
  readonly retryable: boolean

  constructor(failure: LatexCompileFailure & { status?: number; retryAfterSeconds?: number; retryable?: boolean }, cause?: unknown) {
    super(failure.error, { cause })
    this.name = 'LatexTransportError'
    this.error = failure.error
    this.code = failure.code
    this.request_id = failure.request_id
    this.operationKey = failure.operationKey
    this.diagnostics = failure.diagnostics
    this.log = failure.log
    this.status = failure.status
    this.retryAfterSeconds = failure.retryAfterSeconds
    this.retryable = failure.retryable ?? false
  }
}

type LatexTransportDependencies = {
  request?: (input: string, init: RequestInit) => Promise<Response>
  crypto?: Crypto
  now?: () => number
  timeoutMs?: number
}
type RequestContext = { requestId: string; operationKey?: string; signal: AbortSignal }

/** Injected requests keep the exact production contract testable without Next, a server, or a browser. */
export function createLatexCompileTransport(dependencies: LatexTransportDependencies = {}) {
  const request = dependencies.request ?? (async (input: string, init: RequestInit) => {
    const { toolRequest } = await import('@/lib/api/client')
    return toolRequest(input, init)
  })
  const now = dependencies.now ?? Date.now
  const cryptography = () => dependencies.crypto ?? globalThis.crypto
  const requestId = () => {
    const crypto = cryptography()
    if (typeof crypto?.randomUUID === 'function') return `latex-${crypto.randomUUID()}`
    if (typeof crypto?.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      return `latex-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
    }
    throw new LatexTransportError({ error: 'Secure request identity is unavailable in this browser. Use HTTPS or localhost for private compilation.', code: 'crypto_unavailable', request_id: 'latex-local', status: 503 })
  }
  const failure = (context: RequestContext, error: string, code: string, status = 502, cause?: unknown) => new LatexTransportError({ error, code, status, request_id: context.requestId, ...(context.operationKey ? { operationKey: context.operationKey } : {}) }, cause)

  async function run<T>(operationKey: string | undefined, signal: AbortSignal | undefined, compile: boolean, work: (context: RequestContext) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    const context: RequestContext = { requestId: requestId(), operationKey, signal: controller.signal }
    const abort = () => controller.abort()
    if (signal?.aborted) controller.abort()
    else signal?.addEventListener('abort', abort, { once: true })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, dependencies.timeoutMs ?? (compile ? 45_000 : 15_000))
    try {
      if (controller.signal.aborted) throw new DOMException('Stopped waiting for the private compiler', 'AbortError')
      if (operationKey !== undefined) readLatexId(operationKey, 8)
      return await awaitLatexSignal(work(context), controller.signal)
    } catch (cause) {
      if (cause instanceof LatexTransportError) throw cause
      if (timedOut) throw failure(context, 'Stopped waiting after the private compiler deadline. This does not acknowledge cancellation; an admitted operation may be recoverable.', 'upstream_timeout', 504, cause)
      if (controller.signal.aborted || cause instanceof Error && cause.name === 'AbortError') throw failure(context, 'Stopped waiting for the private compiler. Server cancellation has not been acknowledged.', 'request_aborted', 408, cause)
      if (cause instanceof LatexContractError) throw failure(context, cause.message, cause.code, cause.status, cause)
      throw new LatexTransportError({ error: 'The private compiler connection failed. Your local project and previous proof are unchanged; recover the operation explicitly if it was admitted.', code: 'transport_unavailable', request_id: context.requestId, operationKey, retryable: true }, cause)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }

  async function digest(data: ArrayBuffer, context: RequestContext) {
    const crypto = cryptography()
    if (!crypto?.subtle) throw failure(context, 'SHA-256 integrity checking requires HTTPS or localhost. No unverified proof can be accepted.', 'crypto_unavailable', 503)
    try {
      const bytes = new Uint8Array(await awaitLatexSignal(crypto.subtle.digest('SHA-256', data), context.signal))
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    } catch (cause) {
      if (context.signal.aborted) throw cause
      throw failure(context, 'The source or PDF integrity check could not be completed. No unverified proof was accepted.', 'integrity_unavailable', 503, cause)
    }
  }

  async function exchange(action: string, method: 'GET' | 'POST', context: RequestContext, body?: ArrayBuffer, contentType?: string): Promise<Response> {
    const headers = new Headers({ 'X-Request-Id': context.requestId, Accept: action.startsWith('artifacts/') ? 'application/pdf' : 'application/json' })
    if (context.operationKey) headers.set('X-Resume-Operation-Key', context.operationKey)
    if (contentType) headers.set('Content-Type', contentType)
    const response = await awaitLatexSignal(request(`${LATEX_API}/${action}`, {
      method, headers, ...(body ? { body } : {}), credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: context.signal,
    }), context.signal)
    if (response.redirected || response.headers.get('x-request-id') !== context.requestId) {
      if (response.body) void response.body.cancel().catch(() => {})
      throw failure(context, 'The private compiler returned an invalid request identity or redirect.', 'upstream_protocol_error')
    }
    if (!response.ok) {
      let rejected: LatexCompileFailure
      try {
        if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type') ?? '')) throw failure(context, 'The private compiler returned an invalid failure response.', 'upstream_protocol_error')
        const bytes = await readBoundedLatexBytes(response, LATEX_JSON_BYTES, context.signal).catch((cause) => {
          if (cause instanceof LatexContractError) throw failure(context, 'The private compiler returned an oversized or invalid failure response.', 'upstream_protocol_error', 502, cause)
          throw cause
        })
        try {
          rejected = readLatexFailure(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
          if (rejected.request_id !== context.requestId || (rejected.operationKey !== undefined && rejected.operationKey !== context.operationKey)) throw new LatexContractError('Invalid error identity')
        } catch (cause) { throw failure(context, 'The private compiler returned an invalid failure response.', 'upstream_protocol_error', 502, cause) }
      } finally {
        if (response.body && !response.bodyUsed) void response.body.cancel().catch(() => {})
      }
      const retry = response.headers.get('retry-after')
      const seconds = retry === null ? undefined : /^\d+$/.test(retry) ? Number(retry) : Math.ceil((Date.parse(retry) - now()) / 1000)
      const retryAfterSeconds = seconds !== undefined && Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 86_400 ? seconds : undefined
      throw new LatexTransportError({
        ...rejected, operationKey: context.operationKey, status: response.status, retryAfterSeconds,
        retryable: response.status === 429 || ['upstream_unavailable', 'upstream_timeout', 'compiler_busy', 'operation_running', 'admission_unavailable'].includes(rejected.code),
      })
    }
    if (response.status !== 200) {
      if (response.body) void response.body.cancel().catch(() => {})
      throw failure(context, 'The private compiler returned an unsupported response status.', 'upstream_protocol_error')
    }
    return response
  }

  async function jsonResult<T>(response: Response, context: RequestContext, validate: (input: unknown) => T): Promise<T> {
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type') ?? '')) {
      if (response.body) void response.body.cancel().catch(() => {})
      throw failure(context, 'The private compiler returned a non-JSON result.', 'upstream_protocol_error')
    }
    const bytes = await readBoundedLatexBytes(response, LATEX_JSON_BYTES, context.signal).catch((cause) => {
      if (cause instanceof LatexContractError) throw failure(context, 'The private compiler result exceeds its limit or has invalid byte counts.', 'upstream_protocol_error', 502, cause)
      throw cause
    })
    try { return validate(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) }
    catch (cause) { throw failure(context, 'The private compiler returned an invalid or mismatched result.', cause instanceof LatexContractError && cause.code === 'result_mismatch' ? 'result_mismatch' : 'upstream_protocol_error', 502, cause) }
  }

  const getLatexCapabilities = (signal?: AbortSignal): Promise<LatexCapabilities> => run(undefined, signal, false, async (context) => jsonResult(await exchange('capabilities', 'GET', context), context, readLatexCapabilities))

  const compileLatexProject = (project: LatexProject, operationKey: string, signal?: AbortSignal): Promise<LatexProof> => run(operationKey, signal, true, async (context) => {
    if (!project || typeof project !== 'object' || !Array.isArray(project.files) || !Array.isArray(project.assets)) throw new LatexContractError('Invalid local LaTeX project.')
    const assets = project.assets.map((asset) => {
      if (!asset || typeof asset !== 'object' || !(asset.blob instanceof Blob)) throw new LatexContractError('Invalid local project asset.', 'asset_mismatch')
      return { id: asset.id, path: asset.path, mediaType: asset.mediaType, blob: asset.blob, size: asset.blob.size }
    })
    // Capture every source and asset before the first await: typing during compilation cannot mutate this attempt.
    const manifest: LatexCompileManifest = readLatexManifest({
      version: project.version, operationKey, projectId: project.id, title: project.title, revision: project.revision,
      mainFile: project.mainFile, engine: project.engine, files: project.files,
      assets: assets.map(({ id, path, mediaType, size }) => ({ id, path, mediaType, size })),
    })
    const fingerprintAssets = []
    for (const asset of assets) {
      const data = await awaitLatexSignal(asset.blob.arrayBuffer(), context.signal)
      if (data.byteLength !== asset.size || (asset.blob.type && asset.blob.type !== asset.mediaType)) throw new LatexContractError('An asset differs from its declared original byte size or type.', 'asset_mismatch')
      fingerprintAssets.push({ id: asset.id, path: asset.path, mediaType: asset.mediaType, size: asset.size, sha256: await digest(data, context) })
    }
    // This public canonicalization is shared with the backend contract; the backend hashes observed original bytes independently.
    const canonical = JSON.stringify({
      version: manifest.version, projectId: manifest.projectId, revision: manifest.revision, mainFile: manifest.mainFile,
      engine: manifest.engine, files: [...manifest.files].sort(compareLatexPaths), assets: fingerprintAssets.sort(compareLatexPaths),
    })
    const snapshotHash = await digest(new TextEncoder().encode(canonical).buffer, context)
    const form = new FormData()
    form.append('manifest', JSON.stringify(manifest))
    for (const asset of assets) form.append(`asset:${asset.id}`, asset.blob.type ? asset.blob : new Blob([asset.blob], { type: asset.mediaType }), asset.path)
    const encoded = new Response(form)
    const contentType = encoded.headers.get('content-type')!
    // Inputs are already bounded. Fully consume our own multipart encoder, then measure
    // its real overhead; cancelling an unconsumed encoder can leave a producer running.
    const body = await awaitLatexSignal(encoded.arrayBuffer(), context.signal)
    if (body.byteLength > LATEX_LIMITS.uploadBytes) throw new LatexContractError('The complete multipart upload exceeds the 3 MiB limit.', 'payload_too_large', 413)
    const result = await jsonResult(await exchange('compile', 'POST', context, body, contentType), context, (input) => readLatexCompileResult(input, manifest))
    if (result.snapshotHash !== snapshotHash) throw failure(context, 'The returned proof belongs to a different source or asset snapshot.', 'result_mismatch')

    context.requestId = requestId()
    const artifact = await exchange(`artifacts/${result.pdf.id}`, 'GET', context)
    if ((artifact.headers.get('content-type') ?? '').toLowerCase() !== 'application/pdf' || artifact.headers.get('x-resume-pdf-sha256') !== result.pdf.sha256) {
      if (artifact.body) void artifact.body.cancel().catch(() => {})
      throw failure(context, 'The returned artifact does not match the verified PDF manifest.', 'artifact_hash_mismatch')
    }
    const data = await readBoundedLatexBytes(artifact, LATEX_LIMITS.pdfBytes, context.signal).catch((cause) => {
      if (cause instanceof LatexContractError) throw failure(context, 'The PDF artifact exceeds its limit or has inconsistent byte counts.', 'artifact_hash_mismatch', 502, cause)
      throw cause
    })
    if (data.byteLength !== result.pdf.bytes || data.byteLength < 8 || new TextDecoder().decode(new Uint8Array(data, 0, 5)) !== '%PDF-' || await digest(data, context) !== result.pdf.sha256) throw failure(context, 'The PDF artifact failed its original-byte integrity check.', 'artifact_hash_mismatch')
    // PDF.js receives data.slice(0) in the viewer; this canonical buffer remains intact for download/storage.
    return { ...result, data }
  })

  const cancelLatexCompile = (operationKey: string, signal?: AbortSignal): Promise<{ cancelled: boolean; status: string }> => run(operationKey, signal, false, async (context) => jsonResult(await exchange('cancel', 'POST', context, new TextEncoder().encode(JSON.stringify({ operationKey })).buffer, 'application/json'), context, readLatexCancelResult))
  const getLatexOperation = (operationKey: string, signal?: AbortSignal): Promise<LatexOperation> => run(operationKey, signal, false, async (context) => jsonResult(await exchange(`operations/${operationKey}`, 'GET', context), context, (input) => readLatexOperation(input, operationKey)))
  const syncLatexProof = (query: LatexSyncQuery, signal?: AbortSignal): Promise<LatexSyncResult> => run(query?.operationKey, signal, false, async (context) => {
    const validated = readLatexSyncQuery(query)
    const response = await exchange('sync', 'POST', context, new TextEncoder().encode(JSON.stringify(validated)).buffer, 'application/json')
    if (response.headers.get('x-resume-snapshot-hash') !== validated.snapshotHash || response.headers.get('x-resume-pdf-sha256') !== validated.pdfHash) {
      if (response.body) void response.body.cancel().catch(() => {})
      throw failure(context, 'Synchronization is not bound to the requested proof hashes.', 'result_mismatch')
    }
    return jsonResult(response, context, (input) => readLatexSyncResult(input, validated))
  })
  return { getLatexCapabilities, compileLatexProject, cancelLatexCompile, getLatexOperation, syncLatexProof }
}

// Constructing/importing this adapter does not contact the server or start compilation.
const transport = createLatexCompileTransport()
export const getLatexCapabilities = transport.getLatexCapabilities
export const compileLatexProject = transport.compileLatexProject
export const cancelLatexCompile = transport.cancelLatexCompile
export const getLatexOperation = transport.getLatexOperation
export const syncLatexProof = transport.syncLatexProof
