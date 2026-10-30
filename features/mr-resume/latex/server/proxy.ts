import { createHash, randomUUID } from 'node:crypto'
import { LATEX_LIMITS, unavailableLatexCapabilities, type LatexCompileManifest, type LatexSyncQuery } from '../types.ts'
import {
  awaitLatexSignal, LATEX_HASH_PATTERN, LATEX_JSON_BYTES, LATEX_SMALL_REQUEST_BYTES, LatexContractError,
  readBoundedLatexBytes, readLatexCancelResult, readLatexCapabilities, readLatexCompileResult, readLatexFailure,
  readLatexId, readLatexManifest, readLatexOperation, readLatexSyncQuery, readLatexSyncResult,
} from './contract.ts'
import {
  isStrongLatexGuestSecret, isTrustedLatexIpHeader, issueLatexGuest, latexGuestCookie, latexIpFingerprint, readLatexGuest,
} from './principal.ts'

export type LatexProxyRoute =
  | { action: 'capabilities' | 'compile' | 'cancel' | 'sync' }
  | { action: 'operations'; key: string }
  | { action: 'artifacts'; id: string }
export type LatexProxyDependencies = {
  env: Readonly<Record<string, string | undefined>>
  fetch?: (input: string, init: RequestInit) => Promise<Response>
  now?: () => number
  randomUUID?: () => string
  timeoutMs?: number
}

type ProxyConfig = { url: string; key: string; secret: string; production: boolean; trustedIpHeader?: string }
type DisabledConfig = { code: string; reason: string }

function configuration(env: LatexProxyDependencies['env']): ProxyConfig | DisabledConfig {
  if (env.MR_RESUME_LATEX_COMPILE_ENABLED !== 'true') return { code: 'compiler_disabled', reason: 'Private LaTeX compilation is disabled. You can keep editing and export your source project.' }
  const unavailable = { code: 'compiler_not_configured', reason: unavailableLatexCapabilities.reason }
  const rawUrl = env.MR_RESUME_LATEX_SERVICE_URL
  const key = env.MR_RESUME_LATEX_INTERNAL_KEY
  const secret = env.MR_RESUME_LATEX_GUEST_SECRET
  if (!rawUrl || !/^https?:\/\/[^/?#@\s]+\/?$/.test(rawUrl) || !key || !/^[\x21-\x7e]{1,512}$/.test(key) || !isStrongLatexGuestSecret(secret) || key === secret) return unavailable
  try {
    const url = new URL(rawUrl)
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.pathname !== '/' || url.username || url.password || url.search || url.hash) return unavailable
    const rawIpHeader = env.MR_RESUME_LATEX_TRUSTED_IP_HEADER
    const trustedIpHeader = rawIpHeader?.toLowerCase()
    if (trustedIpHeader && !isTrustedLatexIpHeader(trustedIpHeader)) return unavailable
    return { url: url.origin, key, secret, production: env.NODE_ENV === 'production', ...(trustedIpHeader ? { trustedIpHeader } : {}) }
  } catch {
    return unavailable
  }
}

function validateContext(request: Request, stateChanging: boolean) {
  const url = new URL(request.url)
  const origin = request.headers.get('origin')
  if ((stateChanging && !origin) || (origin !== null && origin !== url.origin)) throw new LatexContractError('This compiler request must come from the same origin.', 'invalid_origin', 403)
  const site = request.headers.get('sec-fetch-site')
  const mode = request.headers.get('sec-fetch-mode')
  const destination = request.headers.get('sec-fetch-dest')
  if ((site !== null && site !== 'same-origin' && !(site === 'none' && !stateChanging))
    || (mode !== null && mode !== 'cors' && mode !== 'same-origin')
    || (destination !== null && destination !== 'empty')) throw new LatexContractError('Cross-origin compiler requests are not allowed.', 'invalid_fetch_metadata', 403)
  if (url.searchParams.size) throw new LatexContractError('Unexpected compiler query parameters.', 'invalid_query')
}

function jsonValue(bytes: ArrayBuffer): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new LatexContractError('Invalid UTF-8 JSON body.', 'invalid_json') }
}

function jsonContentType(contentType: string) {
  return /^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType)
}

function retryAfter(response: Response, now: number): string | undefined {
  const raw = response.headers.get('retry-after')
  if (!raw) return undefined
  const seconds = /^\d+$/.test(raw) ? Number(raw) : Math.ceil((Date.parse(raw) - now) / 1000)
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 86_400 ? String(seconds) : undefined
}

/** Thin, feature-owned validating proxy. The backend alone admits, compiles, validates native output, and owns retention. */
export async function handleLatexProxy(request: Request, route: LatexProxyRoute, dependencies: LatexProxyDependencies): Promise<Response> {
  const uuid = dependencies.randomUUID ?? randomUUID
  const now = dependencies.now ?? Date.now
  const suppliedId = request.headers.get('x-request-id')?.trim()
  const requestId = suppliedId && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(suppliedId) ? suppliedId : uuid()
  const headers = new Headers({
    'X-Request-Id': requestId, 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Expires: '0',
    Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin',
  })
  const json = (body: unknown, status = 200, extra?: HeadersInit) => {
    const resultHeaders = new Headers(headers)
    if (extra) new Headers(extra).forEach((value, key) => resultHeaders.set(key, value))
    resultHeaders.set('Content-Type', 'application/json; charset=utf-8')
    return request.method === 'HEAD' ? new Response(null, { status, headers: resultHeaders }) : Response.json(body, { status, headers: resultHeaders })
  }
  let operationKey: string | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  let timedOut = false
  let manifest: LatexCompileManifest | undefined
  let upstream: Response | undefined

  try {
    if (!['capabilities', 'compile', 'cancel', 'sync', 'operations', 'artifacts'].includes(route.action)) throw new LatexContractError('Unknown private compiler action.', 'invalid_route')
    const post = route.action === 'compile' || route.action === 'cancel' || route.action === 'sync'
    if (request.method !== (post ? 'POST' : 'GET') && !(request.method === 'HEAD' && !post)) return json({ error: 'Unsupported compiler request method.', code: 'method_not_allowed', request_id: requestId }, 405, { Allow: post ? 'POST' : 'GET, HEAD' })
    const config = configuration(dependencies.env)
    if ('reason' in config) return route.action === 'capabilities'
      ? json({ ...unavailableLatexCapabilities, reason: config.reason, limits: { ...LATEX_LIMITS } })
      : json({ error: config.reason, code: config.code, request_id: requestId }, 503)
    validateContext(request, post)
    const existingGuest = readLatexGuest(request, config.secret, now())
    const issuedGuest = route.action === 'capabilities' && !existingGuest ? issueLatexGuest(config.secret, now(), uuid) : undefined
    const guest = existingGuest ?? issuedGuest?.principal
    if (!guest) return json({ error: 'Your private compiler session is missing or expired. Reopen the LaTeX workspace to start a new session; old server artifacts remain private.', code: 'guest_session_required', request_id: requestId }, 401)

    const controller = new AbortController()
    abort = () => controller.abort()
    if (request.signal.aborted) controller.abort()
    else request.signal.addEventListener('abort', abort, { once: true })
    timeout = setTimeout(() => { timedOut = true; controller.abort() }, dependencies.timeoutMs ?? (route.action === 'compile' ? 35_000 : 10_000))
    let upstreamPath: string = route.action
    let body: ArrayBuffer | undefined
    let contentType: string | undefined
    let syncQuery: LatexSyncQuery | undefined
    if (post) {
      const encoding = request.headers.get('content-encoding')
      if (encoding !== null && encoding.toLowerCase() !== 'identity') throw new LatexContractError('Compressed compiler requests are not supported.', 'unsupported_content_encoding', 415)
      contentType = request.headers.get('content-type') ?? ''
      if (route.action === 'compile') {
        if (!/^multipart\/form-data;\s*boundary=(?:"[A-Za-z0-9'()+_,./:=?-]{1,70}"|[A-Za-z0-9'()+_,./:=?-]{1,70})$/i.test(contentType)) throw new LatexContractError('Compile requires a manifest and assets in multipart form data.', 'invalid_multipart_form', 415)
        const bytes = await readBoundedLatexBytes(request, LATEX_LIMITS.uploadBytes, controller.signal)
        let form: FormData
        try { form = await awaitLatexSignal(new Response(bytes, { headers: { 'Content-Type': contentType } }).formData(), controller.signal) }
        catch (error) {
          if (controller.signal.aborted) throw error
          throw new LatexContractError('Invalid multipart compiler request.', 'invalid_multipart_form')
        }
        const manifests = form.getAll('manifest')
        if (manifests.length !== 1 || typeof manifests[0] !== 'string') throw new LatexContractError('Exactly one JSON manifest is required.', 'invalid_manifest')
        manifest = readLatexManifest(jsonValue(new TextEncoder().encode(manifests[0]).buffer))
        operationKey = manifest.operationKey
        const allowed = new Set(['manifest', ...manifest.assets.map((asset) => `asset:${asset.id}`)])
        for (const key of form.keys()) if (!allowed.has(key)) throw new LatexContractError('Unexpected multipart compiler field.', 'invalid_multipart_form')
        const forwarded = new FormData()
        forwarded.append('manifest', JSON.stringify(manifest))
        for (const asset of manifest.assets) {
          const parts = form.getAll(`asset:${asset.id}`)
          const part = parts[0]
          if (parts.length !== 1 || typeof part === 'string' || !(part instanceof Blob) || part.size !== asset.size || part.type !== asset.mediaType) throw new LatexContractError('An asset is missing or differs from its declared type or byte size.', 'asset_mismatch')
          forwarded.append(`asset:${asset.id}`, part, asset.path)
        }
        const encoded = new Response(forwarded)
        contentType = encoded.headers.get('content-type')!
        body = await awaitLatexSignal(encoded.arrayBuffer(), controller.signal)
        if (body.byteLength > LATEX_LIMITS.uploadBytes) throw new LatexContractError('Canonical multipart body exceeds the transported byte limit.', 'payload_too_large', 413)
      } else {
        if (!jsonContentType(contentType)) throw new LatexContractError('This compiler request requires UTF-8 JSON.', 'unsupported_content_type', 415)
        const input = jsonValue(await readBoundedLatexBytes(request, LATEX_SMALL_REQUEST_BYTES, controller.signal))
        if (route.action === 'cancel') {
          if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'operationKey')) throw new LatexContractError('Cancel requires exactly one operation key.', 'invalid_operation')
          operationKey = readLatexId((input as Record<string, unknown>).operationKey, 8)
          body = new TextEncoder().encode(JSON.stringify({ operationKey })).buffer
        } else {
          syncQuery = readLatexSyncQuery(input)
          operationKey = syncQuery.operationKey
          body = new TextEncoder().encode(JSON.stringify(syncQuery)).buffer
        }
        contentType = 'application/json'
      }
    } else {
      if (request.body !== null || Number(request.headers.get('content-length') ?? 0) !== 0) throw new LatexContractError('Read-only compiler requests cannot contain a body.', 'unexpected_body')
      if (route.action === 'operations') { operationKey = readLatexId(route.key, 8); upstreamPath = `operations/${operationKey}` }
      if (route.action === 'artifacts') upstreamPath = `artifacts/${readLatexId(route.id)}`
    }
    const assertedOperation = request.headers.get('x-resume-operation-key')
    if (assertedOperation !== null) {
      const asserted = readLatexId(assertedOperation, 8)
      if (operationKey && asserted !== operationKey) throw new LatexContractError('The operation header does not match the request.', 'operation_key_mismatch')
      if (route.action === 'artifacts') operationKey = asserted
    }
    if (controller.signal.aborted) throw new DOMException('Stopped waiting for the private compiler', 'AbortError')

    // Construct from scratch: client cookies, authorization, forwarded IPs and identity/internal headers never cross this boundary.
    const upstreamHeaders = new Headers({
      'X-Resume-Internal-Key': config.key, 'X-Resume-Principal': guest.id,
      'X-Resume-IP': latexIpFingerprint(request, config.secret, config.trustedIpHeader), 'X-Request-Id': requestId,
      Accept: route.action === 'artifacts' ? 'application/pdf' : 'application/json', 'Accept-Encoding': 'identity',
    })
    if (operationKey) upstreamHeaders.set('X-Resume-Operation-Key', operationKey)
    if (contentType) upstreamHeaders.set('Content-Type', contentType)
    if (body) upstreamHeaders.set('Content-Length', String(body.byteLength))
    upstream = await awaitLatexSignal((dependencies.fetch ?? fetch)(`${config.url}/mr-resume-latex/${upstreamPath}`, {
      method: post ? 'POST' : 'GET', headers: upstreamHeaders, ...(body ? { body } : {}),
      cache: 'no-store', redirect: 'manual', signal: controller.signal,
    }), controller.signal)
    if (upstream.redirected || (upstream.status >= 300 && upstream.status < 400)) throw new LatexContractError('The private compiler returned an unexpected redirect.', 'upstream_protocol_error', 502)

    if (!upstream.ok) {
      if (![400, 404, 409, 410, 413, 415, 422, 429, 502, 503, 504].includes(upstream.status) || !jsonContentType(upstream.headers.get('content-type') ?? '')) throw new LatexContractError('The private compiler is unavailable.', 'upstream_unavailable', 502)
      let failure
      try {
        failure = readLatexFailure(jsonValue(await readBoundedLatexBytes(upstream, LATEX_JSON_BYTES, controller.signal)), manifest && new Set([...manifest.files, ...manifest.assets].map((file) => file.path)))
        if (failure.operationKey && operationKey && failure.operationKey !== operationKey) throw new LatexContractError('Mismatched operation')
      } catch (error) {
        if (controller.signal.aborted || !(error instanceof LatexContractError)) throw error
        throw new LatexContractError('The private compiler returned an invalid failure response.', 'upstream_protocol_error', 502)
      }
      const retry = retryAfter(upstream, now())
      return json({ ...failure, request_id: requestId, ...(operationKey ? { operationKey } : {}) }, upstream.status, retry === undefined ? undefined : { 'Retry-After': retry })
    }
    if (upstream.status !== 200) throw new LatexContractError('The private compiler returned an unsupported response status.', 'upstream_protocol_error', 502)

    if (route.action === 'artifacts') {
      if ((upstream.headers.get('content-type') ?? '').toLowerCase() !== 'application/pdf') throw new LatexContractError('The private compiler did not return a PDF artifact.', 'upstream_protocol_error', 502)
      let data: ArrayBuffer
      try { data = await readBoundedLatexBytes(upstream, LATEX_LIMITS.pdfBytes, controller.signal) }
      catch (error) {
        if (!(error instanceof LatexContractError)) throw error
        throw new LatexContractError('The private PDF artifact exceeds its limit or has an invalid byte size.', 'upstream_protocol_error', 502)
      }
      const digest = upstream.headers.get('x-resume-pdf-sha256') ?? ''
      if (!data.byteLength || !LATEX_HASH_PATTERN.test(digest) || createHash('sha256').update(new Uint8Array(data)).digest('hex') !== digest) throw new LatexContractError('The private PDF artifact failed its integrity check.', 'artifact_hash_mismatch', 502)
      const artifactHeaders = new Headers(headers)
      artifactHeaders.set('Content-Type', 'application/pdf')
      artifactHeaders.set('Content-Disposition', 'attachment; filename="resume.pdf"')
      artifactHeaders.set('Content-Length', String(data.byteLength))
      artifactHeaders.set('X-Resume-PDF-SHA256', digest)
      return new Response(request.method === 'HEAD' ? null : data, { headers: artifactHeaders })
    }
    if (!jsonContentType(upstream.headers.get('content-type') ?? '')) throw new LatexContractError('The private compiler returned a non-JSON response.', 'upstream_protocol_error', 502)
    let result: unknown
    try {
      const input = jsonValue(await readBoundedLatexBytes(upstream, LATEX_JSON_BYTES, controller.signal))
      if (route.action === 'capabilities') {
        const capabilities = readLatexCapabilities(input)
        result = capabilities
        if (capabilities.enabled && capabilities.ready) {
          const fresh = issuedGuest ?? (existingGuest && now() / 1000 - existingGuest.issuedAt >= 60 * 60 ? issueLatexGuest(config.secret, now(), () => existingGuest.id) : undefined)
          if (fresh) headers.set('Set-Cookie', latexGuestCookie(fresh.token, request, config.production))
        }
      } else if (route.action === 'compile') result = readLatexCompileResult(input, manifest)
      else if (route.action === 'cancel') result = readLatexCancelResult(input)
      else if (route.action === 'operations') result = readLatexOperation(input, operationKey!)
      else {
        if (!syncQuery || upstream.headers.get('x-resume-snapshot-hash') !== syncQuery.snapshotHash || upstream.headers.get('x-resume-pdf-sha256') !== syncQuery.pdfHash) throw new LatexContractError('Synchronization is not bound to the requested source and PDF hashes.')
        result = readLatexSyncResult(input, syncQuery)
        headers.set('X-Resume-Snapshot-Hash', syncQuery.snapshotHash)
        headers.set('X-Resume-PDF-SHA256', syncQuery.pdfHash)
      }
    } catch (error) {
      if (!(error instanceof LatexContractError)) throw error
      throw new LatexContractError('The private compiler returned an invalid or mismatched result.', error.code === 'result_mismatch' ? 'result_mismatch' : 'upstream_protocol_error', 502)
    }
    return json(result)
  } catch (error) {
    const failure = timedOut ? { error: 'The private compiler timed out. Work may still be bounded by its server deadline; cancellation has not been acknowledged.', code: 'upstream_timeout', status: 504 }
      : request.signal.aborted ? { error: 'Stopped waiting for the private compiler. This does not confirm that server work was cancelled.', code: 'request_aborted', status: 408 }
        : error instanceof LatexContractError ? { error: error.message, code: error.code, status: error.status }
          : { error: 'The private compiler connection failed. Local editing is unaffected; use the operation key to recover an admitted attempt.', code: 'upstream_unavailable', status: 502 }
    return json({ error: failure.error, code: failure.code, request_id: requestId, ...(operationKey ? { operationKey } : {}) }, failure.status)
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    if (abort) request.signal.removeEventListener('abort', abort)
    if (upstream?.body && !upstream.bodyUsed) void upstream.body.cancel().catch(() => {})
  }
}
