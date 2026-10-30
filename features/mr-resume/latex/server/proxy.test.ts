import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { LATEX_LIMITS, type LatexCompileManifest, type LatexCompileResult } from '../types.ts'
import { LATEX_GUEST_COOKIE, LATEX_GUEST_TTL_SECONDS, issueLatexGuest, latexIpFingerprint, verifyLatexGuestToken } from './principal.ts'
import { handleLatexProxy, type LatexProxyDependencies, type LatexProxyRoute } from './proxy.ts'

const origin = 'https://resume.example'
const now = Date.parse('2026-10-29T09:00:00Z')
const principalId = '75f7b103-2b30-4df1-9a0d-9cb584d1634a'
const newPrincipalId = '542a6031-f608-4ee6-8e63-5d92b16df1f0'
const secret = 'unit-only-a9sE07pV24qK86wZ10nR59dG31tY68mF42cL95uH73'
const env = { MR_RESUME_LATEX_COMPILE_ENABLED: 'true', MR_RESUME_LATEX_SERVICE_URL: 'http://compiler.private:9000', MR_RESUME_LATEX_INTERNAL_KEY: 'unit-only-private-compiler-key', MR_RESUME_LATEX_GUEST_SECRET: secret }
const cookie = `${LATEX_GUEST_COOKIE}=${issueLatexGuest(secret, now, () => principalId).token}`
const operationKey = 'compile-operation-7'
const pdf = new TextEncoder().encode('%PDF-1.7\n% byte-transport contract fixture\n%%EOF\n')
const pdfHash = createHash('sha256').update(pdf).digest('hex')
const snapshotHash = 'a'.repeat(64)

function manifest(overrides: Partial<LatexCompileManifest> = {}): LatexCompileManifest {
  return { version: 1, operationKey, projectId: 'project-one', title: 'My resume', revision: 7, mainFile: 'resume.tex', engine: 'lualatex', files: [{ id: 'main', path: 'resume.tex', content: '\\documentclass{article}\r\n% \u09ac\u09be\u0982\u09b2\u09be \u200d\u200c\n' }], assets: [], ...overrides }
}

function ready(input = manifest(), overrides: Partial<LatexCompileResult> = {}): LatexCompileResult {
  return { status: 'ready', operationKey: input.operationKey, projectId: input.projectId, revision: input.revision, snapshotHash, engine: input.engine, profileVersion: 'unit-test-profile', pdf: { id: 'artifact-one', sha256: pdfHash, bytes: pdf.byteLength, pages: 1 }, diagnostics: [], log: '', syncAvailable: true, createdAt: '2026-10-29T09:00:00Z', ...overrides }
}

const capabilities = () => ({ enabled: true, ready: true, reason: '', profiles: [{ id: 'lualatex', name: 'LuaLaTeX', version: 'unit-test-profile', fonts: ['Latin Modern Roman'], packages: ['geometry'] }], limits: { ...LATEX_LIMITS } })

function form(input = manifest(), assets: { id: string; bytes: Blob; path?: string }[] = []) {
  const body = new FormData()
  body.append('manifest', JSON.stringify(input))
  for (const asset of assets) body.append(`asset:${asset.id}`, asset.bytes, asset.path ?? 'upload.png')
  return body
}

function request(action: string, init: RequestInit = {}) {
  const post = ['compile', 'cancel', 'sync'].includes(action)
  const headers = new Headers({ Cookie: cookie, 'X-Request-Id': 'latex-contract', 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty', ...(post ? { Origin: origin } : {}) })
  new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  return new Request(`${origin}/api/mr-resume/latex/${action}`, { method: post ? 'POST' : 'GET', ...init, headers })
}

const dependencies = (fetch: NonNullable<LatexProxyDependencies['fetch']>, overrides: Partial<LatexProxyDependencies> = {}): LatexProxyDependencies => ({ env, fetch, now: () => now, randomUUID: () => newPrincipalId, ...overrides })
const noFetch = () => { assert.fail('No upstream call was permitted'); return Promise.resolve(Response.json({})) }

async function failure(response: Response, status: number, code?: string) {
  assert.equal(response.status, status)
  assert.match(response.headers.get('cache-control') ?? '', /no-store/)
  assert.equal(response.headers.get('x-request-id'), 'latex-contract')
  const body = await response.json()
  assert.equal(body.request_id, 'latex-contract')
  assert.equal(typeof body.error, 'string')
  if (code) assert.equal(body.code, code)
  return body
}

test('disabled capabilities are HTTP 200 with no fetch or cookie; disabled POST is a clear HTTP 503', async () => {
  for (const flag of [undefined, 'false', 'TRUE', ' true ', '1']) {
    const deps = dependencies(noFetch, { env: { ...env, MR_RESUME_LATEX_COMPILE_ENABLED: flag } })
    const response = await handleLatexProxy(request('capabilities'), { action: 'capabilities' }, deps)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.enabled, false)
    assert.equal(body.ready, false)
    assert.deepEqual(body.profiles, [])
    assert.deepEqual(body.limits, LATEX_LIMITS)
    assert.equal(response.headers.get('set-cookie'), null)
    await failure(await handleLatexProxy(request('compile', { body: form() }), { action: 'compile' }, deps), 503, 'compiler_disabled')
  }
})

test('invalid/missing private setup has no localhost fallback or network call', async () => {
  const invalid = [
    { MR_RESUME_LATEX_SERVICE_URL: undefined }, { MR_RESUME_LATEX_SERVICE_URL: 'http://user:secret@compiler.private:9000' },
    { MR_RESUME_LATEX_SERVICE_URL: 'http://compiler.private:9000/other' }, { MR_RESUME_LATEX_SERVICE_URL: 'http://compiler.private:9000/?token=secret' },
    { MR_RESUME_LATEX_SERVICE_URL: 'http://compiler.private:9000/#fragment' }, { MR_RESUME_LATEX_SERVICE_URL: 'file:///tmp/compiler' },
    { MR_RESUME_LATEX_INTERNAL_KEY: '' }, { MR_RESUME_LATEX_GUEST_SECRET: '' }, { MR_RESUME_LATEX_GUEST_SECRET: 'a'.repeat(64) },
    { MR_RESUME_LATEX_INTERNAL_KEY: secret }, { MR_RESUME_LATEX_TRUSTED_IP_HEADER: 'authorization' },
  ]
  for (const invalidEnv of invalid) {
    const deps = dependencies(noFetch, { env: { ...env, ...invalidEnv } })
    const response = await handleLatexProxy(request('capabilities'), { action: 'capabilities' }, deps)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).enabled, false)
    await failure(await handleLatexProxy(request('compile', { body: form() }), { action: 'compile' }, deps), 503, 'compiler_not_configured')
  }
})

test('forged, expired or unsigned identities cannot read existing operations/artifacts or compile', async () => {
  const expired = issueLatexGuest(secret, now - LATEX_GUEST_TTL_SECONDS * 1000, () => principalId).token
  for (const raw of [`${LATEX_GUEST_COOKIE}=forged`, `${LATEX_GUEST_COOKIE}=${expired}`, `guest_id=${principalId}`, `${cookie}; ${cookie}`]) {
    for (const route of [{ action: 'operations', key: operationKey }, { action: 'artifacts', id: 'artifact-one' }, { action: 'compile' }] as LatexProxyRoute[]) {
      const action = route.action === 'operations' ? `operations/${operationKey}` : route.action === 'artifacts' ? 'artifacts/artifact-one' : 'compile'
      const response = await handleLatexProxy(request(action, { headers: { Cookie: raw, 'X-Resume-Principal': principalId }, ...(route.action === 'compile' ? { body: form() } : {}) }), route, dependencies(noFetch))
      await failure(response, 401, 'guest_session_required')
      assert.equal(response.headers.get('set-cookie'), null)
    }
  }
})

test('capabilities can explicitly establish a fresh session, never reusing a forged claimed identity', async () => {
  let principal = ''
  const response = await handleLatexProxy(request('capabilities', { headers: { Cookie: `${LATEX_GUEST_COOKIE}=forged`, 'X-Resume-Principal': principalId } }), { action: 'capabilities' }, dependencies(async (_url, init) => {
    principal = new Headers(init.headers).get('x-resume-principal')!
    return Response.json(capabilities())
  }))
  assert.equal(principal, newPrincipalId)
  assert.notEqual(principal, principalId)
  assert.equal(response.status, 200)
  const header = response.headers.get('set-cookie')!
  assert.match(header, /HttpOnly; SameSite=Strict; Secure/)
  const token = header.split(';')[0].slice(LATEX_GUEST_COOKIE.length + 1)
  assert.equal(verifyLatexGuestToken(token, secret, now)?.id, newPrincipalId)
  const oldRead = await handleLatexProxy(request('artifacts/artifact-one', { headers: { Cookie: header.split(';')[0] } }), { action: 'artifacts', id: 'artifact-one' }, dependencies(async (_url, init) => {
    assert.equal(new Headers(init.headers).get('x-resume-principal'), newPrincipalId)
    return Response.json({ error: 'Artifact not found for this session.', code: 'artifact_not_found', request_id: 'upstream-request' }, { status: 404 })
  }))
  await failure(oldRead, 404, 'artifact_not_found')
})

test('unready backend capabilities issue no new compiler identity', async () => {
  const req = request('capabilities')
  req.headers.delete('cookie')
  const response = await handleLatexProxy(req, { action: 'capabilities' }, dependencies(async () => Response.json({ ...capabilities(), enabled: false, ready: false, profiles: [], reason: 'Sandbox is unavailable.' })))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('set-cookie'), null)
})

test('state-changing origin and Fetch Metadata fail closed, including same-site sibling origins', async () => {
  const changes: HeadersInit[] = [
    { Origin: 'https://other.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'none' }, { 'Sec-Fetch-Mode': 'navigate' }, { 'Sec-Fetch-Mode': 'no-cors' }, { 'Sec-Fetch-Dest': 'document' },
  ]
  for (const changed of changes) await failure(await handleLatexProxy(request('compile', { body: form(), headers: changed }), { action: 'compile' }, dependencies(noFetch)), 403)
  const req = request('compile', { body: form() })
  req.headers.delete('origin')
  await failure(await handleLatexProxy(req, { action: 'compile' }, dependencies(noFetch)), 403, 'invalid_origin')
  await failure(await handleLatexProxy(request('capabilities', { headers: { 'Sec-Fetch-Site': 'cross-site' } }), { action: 'capabilities' }, dependencies(noFetch)), 403)
})

test('forwarding uses fixed URLs and fresh headers while preserving the complete manifest and original asset bytes', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 99])
  const input = manifest({ assets: [{ id: 'photo', path: 'assets/photo.png', mediaType: 'image/png', size: bytes.length }] })
  let count = 0
  const req = request('compile', {
    body: form(input, [{ id: 'photo', bytes: new Blob([bytes], { type: 'image/png' }) }]),
    headers: { Cookie: `${cookie}; guest_id=unsigned`, Authorization: 'Bearer attacker', 'X-Resume-Internal-Key': 'attacker', 'X-Resume-Principal': newPrincipalId, 'X-Resume-IP': 'raw-ip', 'X-Forwarded-For': '203.0.113.42', Forwarded: 'for=192.0.2.1', 'X-Credit-Cost': '999', 'X-User-Id': 'attacker', 'X-Resume-Operation-Key': operationKey },
  })
  const response = await handleLatexProxy(req, { action: 'compile' }, dependencies(async (url, init) => {
    count++
    assert.equal(url, 'http://compiler.private:9000/mr-resume-latex/compile')
    assert.equal(init.cache, 'no-store')
    assert.equal(init.redirect, 'manual')
    assert.equal(init.method, 'POST')
    assert.ok(init.signal instanceof AbortSignal)
    const headers = new Headers(init.headers)
    assert.equal(headers.get('x-resume-internal-key'), env.MR_RESUME_LATEX_INTERNAL_KEY)
    assert.equal(headers.get('x-resume-principal'), principalId)
    assert.equal(headers.get('x-resume-ip'), latexIpFingerprint(req, secret))
    assert.equal(headers.get('x-resume-operation-key'), operationKey)
    for (const stripped of ['cookie', 'authorization', 'origin', 'x-forwarded-for', 'forwarded', 'x-credit-cost', 'x-user-id', 'sec-fetch-site']) assert.equal(headers.get(stripped), null)
    assert.ok(init.body instanceof ArrayBuffer)
    assert.ok(init.body.byteLength <= LATEX_LIMITS.uploadBytes)
    const uploaded = await new Response(init.body, { headers }).formData()
    assert.deepEqual(JSON.parse(String(uploaded.get('manifest'))), input)
    assert.deepEqual(new Uint8Array(await (uploaded.get('asset:photo') as Blob).arrayBuffer()), bytes)
    return Response.json(ready(input))
  }))
  assert.equal(count, 1)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), ready(input))
})

test('3 MiB upload limit uses observed bytes, not absent or lying Content-Length', async () => {
  for (const length of [undefined, '1', String(LATEX_LIMITS.uploadBytes + 1)]) {
    const headers = new Headers({ 'Content-Type': 'multipart/form-data; boundary=x' })
    if (length) headers.set('Content-Length', length)
    await failure(await handleLatexProxy(request('compile', { headers, body: new Uint8Array(LATEX_LIMITS.uploadBytes + 1) }), { action: 'compile' }, dependencies(noFetch)), 413, 'payload_too_large')
  }
  await failure(await handleLatexProxy(request('compile', { headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': '1' }, body: 'body-length-is-not-one' }), { action: 'compile' }, dependencies(noFetch)), 400, 'body_length_mismatch')
})

test('source, file, path, identifier and main-file bounds are enforced before forwarding', async () => {
  const cases: [LatexCompileManifest, number][] = [
    [manifest({ files: [{ id: 'main', path: 'resume.tex', content: 'x'.repeat(LATEX_LIMITS.sourceBytes + 1) }] }), 413],
    [manifest({ files: [{ id: 'main', path: 'resume.tex', content: 'x'.repeat(LATEX_LIMITS.sourceBytes / 2 + 1) }, { id: 'other', path: 'other.tex', content: 'y'.repeat(LATEX_LIMITS.sourceBytes / 2) }] }), 413],
    [manifest({ files: Array.from({ length: 33 }, (_, index) => ({ id: `file-${index}`, path: index ? `f${index}.tex` : 'resume.tex', content: '' })) }), 400],
    [manifest({ mainFile: 'missing.tex' }), 400], [manifest({ operationKey: '../escape' }), 400],
    [manifest({ files: [{ id: 'main', path: '../resume.tex', content: '' }] }), 400],
    [manifest({ files: [{ id: 'main', path: 'resume.tex', content: '' }, { id: 'other', path: 'RESUME.tex', content: '' }] }), 400],
    [manifest({ files: [{ id: 'main', path: 'resume.tex', content: '\ud800' }] }), 400],
    [manifest({ files: [{ id: 'main', path: 'resume.exe', content: '' }] }), 415],
  ]
  for (const [input, status] of cases) await failure(await handleLatexProxy(request('compile', { body: form(input) }), { action: 'compile' }, dependencies(noFetch)), status)
})

test('unknown or duplicate multipart fields, unknown DTO fields and missing/mismatched asset parts are rejected', async () => {
  const input = manifest({ assets: [{ id: 'photo', path: 'photo.png', mediaType: 'image/png', size: 3 }] })
  const cases = [form(), form(), form(input), form(input, [{ id: 'photo', bytes: new Blob(['wrong size'], { type: 'image/png' }) }]), form(input, [{ id: 'photo', bytes: new Blob(['123'], { type: 'image/jpeg' }) }])]
  cases[0].append('manifest', JSON.stringify(manifest()))
  cases[1].append('principal', principalId)
  for (const body of cases) await failure(await handleLatexProxy(request('compile', { body }), { action: 'compile' }, dependencies(noFetch)), 400)
  const extra = new FormData()
  extra.append('manifest', JSON.stringify({ ...manifest(), serviceUrl: 'http://attacker' }))
  await failure(await handleLatexProxy(request('compile', { body: extra }), { action: 'compile' }, dependencies(noFetch)), 400)
  await failure(await handleLatexProxy(request('compile', { body: form(), headers: { 'X-Resume-Operation-Key': 'another-operation' } }), { action: 'compile' }, dependencies(noFetch)), 400, 'operation_key_mismatch')
})

test('JSON state-changing bodies are strictly bounded and cannot choose identity or URLs', async () => {
  for (const body of [{ operationKey, principal: principalId }, { operationKey, url: 'http://attacker' }, { operationKey: '../escape' }, []]) await failure(await handleLatexProxy(request('cancel', { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), { action: 'cancel' }, dependencies(noFetch)), 400)
  await failure(await handleLatexProxy(request('cancel', { body: 'x'.repeat(16 * 1024 + 1), headers: { 'Content-Type': 'application/json' } }), { action: 'cancel' }, dependencies(noFetch)), 413)
  await failure(await handleLatexProxy(request('compile', { body: form(), headers: { 'Content-Encoding': 'gzip' } }), { action: 'compile' }, dependencies(noFetch)), 415)
  await failure(await handleLatexProxy(request('operations/key?url=http://attacker'), { action: 'operations', key: operationKey }, dependencies(noFetch)), 400, 'invalid_query')
  await failure(await handleLatexProxy(request('artifacts/id'), { action: 'artifacts', id: '../escape' }, dependencies(noFetch)), 400)
})

test('the server adapter rejects unrecognized runtime actions rather than forwarding arbitrary service paths', async () => {
  for (const action of ['../private', 'health?token=secret', 'https://attacker']) {
    await failure(await handleLatexProxy(request('capabilities'), { action } as LatexProxyRoute, dependencies(noFetch)), 400, 'invalid_route')
  }
})

test('mapped refusal diagnostics/logs and fair-use Retry-After are preserved without leaking upstream headers', async () => {
  const response = await handleLatexProxy(request('compile', { body: form() }), { action: 'compile' }, dependencies(async () => Response.json({ error: 'Guest compile fair-use limit reached.', code: 'rate_limited', request_id: 'upstream-request', operationKey, diagnostics: [{ severity: 'warning', message: 'Wait before trying again.', file: 'resume.tex', line: 3 }], log: 'bounded private log' }, { status: 429, headers: { 'Retry-After': '45', 'Set-Cookie': 'backend-secret=never-forward', 'X-Resume-Internal-Key': 'never-forward' } })))
  const body = await failure(response, 429, 'rate_limited')
  assert.equal(body.log, 'bounded private log')
  assert.equal(body.diagnostics[0].line, 3)
  assert.equal(response.headers.get('retry-after'), '45')
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(response.headers.get('x-resume-internal-key'), null)
})

test('invalid result identities, limits, logs, diagnostic paths and nonterminal HTTP success fail closed', async () => {
  for (const body of [
    ready(manifest(), { revision: 8 }), ready(manifest(), { projectId: 'other-project' }),
    ready(manifest(), { pdf: { id: 'artifact-one', sha256: pdfHash, bytes: pdf.length, pages: 33 } }),
    ready(manifest(), { log: 'x'.repeat(LATEX_LIMITS.logBytes + 1) }),
    ready(manifest(), { diagnostics: [{ severity: 'error', message: 'Unsafe path', file: '/private/scratch/resume.tex' }] }),
    ready(manifest(), { diagnostics: [{ severity: 'error', message: 'Wrong file', file: 'outside.tex' }] }),
  ]) await failure(await handleLatexProxy(request('compile', { body: form() }), { action: 'compile' }, dependencies(async () => Response.json(body))), 502)
  await failure(await handleLatexProxy(request('compile', { body: form() }), { action: 'compile' }, dependencies(async () => Response.json({ status: 'running', operationKey }, { status: 202 }))), 502, 'upstream_protocol_error')
})

test('binary artifacts are bounded, hash-checked, original-byte and no-cache responses', async () => {
  const response = await handleLatexProxy(request('artifacts/artifact-one'), { action: 'artifacts', id: 'artifact-one' }, dependencies(async (url) => {
    assert.equal(url, 'http://compiler.private:9000/mr-resume-latex/artifacts/artifact-one')
    return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'X-Resume-PDF-SHA256': pdfHash, 'Content-Length': String(pdf.length), 'Cache-Control': 'public, max-age=999' } })
  }))
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control')!, /no-store/)
  assert.match(response.headers.get('content-disposition')!, /attachment/)
  assert.equal(response.headers.get('x-resume-pdf-sha256'), pdfHash)
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pdf)
  for (const upstream of [
    new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'X-Resume-PDF-SHA256': snapshotHash } }),
    new Response(pdf, { headers: { 'Content-Type': 'text/html', 'X-Resume-PDF-SHA256': pdfHash } }),
    new Response(new Uint8Array(LATEX_LIMITS.pdfBytes + 1), { headers: { 'Content-Type': 'application/pdf', 'X-Resume-PDF-SHA256': pdfHash, 'Content-Length': '1' } }),
  ]) await failure(await handleLatexProxy(request('artifacts/artifact-one'), { action: 'artifacts', id: 'artifact-one' }, dependencies(async () => upstream)), 502)
})

test('late response-body failures and timeouts are mapped after headers without partial success', async () => {
  const late = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); controller.error(new Error('private network detail must not leak')) } }), { headers: { 'Content-Type': 'application/json' } })
  const failed = await failure(await handleLatexProxy(request('operations/key'), { action: 'operations', key: operationKey }, dependencies(async () => late)), 502, 'upstream_unavailable')
  assert.doesNotMatch(failed.error, /private network detail/)
  let cancelled = false
  let signal: AbortSignal | undefined
  const stalled = new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { 'Content-Type': 'application/json' } })
  const timeout = await handleLatexProxy(request('operations/key'), { action: 'operations', key: operationKey }, dependencies(async (_url, init) => { signal = init.signal as AbortSignal; return stalled }, { timeoutMs: 5 }))
  await failure(timeout, 504, 'upstream_timeout')
  assert.equal(signal?.aborted, true)
  assert.equal(cancelled, true)
})

test('client aborts do not pretend server cancellation, and upstream redirects are never followed', async () => {
  const controller = new AbortController()
  controller.abort()
  await failure(await handleLatexProxy(request('compile', { body: form(), signal: controller.signal }), { action: 'compile' }, dependencies(noFetch)), 408, 'request_aborted')
  let calls = 0
  await failure(await handleLatexProxy(request('capabilities'), { action: 'capabilities' }, dependencies(async (_url, init) => {
    calls++
    assert.equal(init.redirect, 'manual')
    return new Response(null, { status: 302, headers: { Location: 'http://attacker/secret' } })
  })), 502, 'upstream_protocol_error')
  assert.equal(calls, 1)
})

test('cancellation is true only for acknowledged cancelled state and operation recovery matches its key', async () => {
  for (const result of [{ cancelled: true, status: 'cancelled' }, { cancelled: false, status: 'running' }, { cancelled: false, status: 'ready' }]) {
    const response = await handleLatexProxy(request('cancel', { body: JSON.stringify({ operationKey }), headers: { 'Content-Type': 'application/json' } }), { action: 'cancel' }, dependencies(async () => Response.json(result)))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), result)
  }
  await failure(await handleLatexProxy(request('cancel', { body: JSON.stringify({ operationKey }), headers: { 'Content-Type': 'application/json' } }), { action: 'cancel' }, dependencies(async () => Response.json({ cancelled: true, status: 'running' }))), 502)
  const recovered = await handleLatexProxy(request('operations/key'), { action: 'operations', key: operationKey }, dependencies(async () => Response.json(ready())))
  assert.equal(recovered.status, 200)
  await failure(await handleLatexProxy(request('operations/key'), { action: 'operations', key: operationKey }, dependencies(async () => Response.json({ status: 'running', operationKey: 'different-operation' }))), 502)
})

test('SyncTeX transport requires exact proof hashes and refuses guessed/unsafe mappings', async () => {
  const query = { operationKey, snapshotHash, pdfHash, direction: 'forward', file: 'resume.tex', line: 3 }
  const req = () => request('sync', { body: JSON.stringify(query), headers: { 'Content-Type': 'application/json' } })
  const headers = { 'X-Resume-Snapshot-Hash': snapshotHash, 'X-Resume-PDF-SHA256': pdfHash }
  const valid = { available: true, file: 'resume.tex', line: 3, locations: [{ page: 1, x: 18, y: 24, width: 120, height: 14 }] }
  const response = await handleLatexProxy(req(), { action: 'sync' }, dependencies(async () => Response.json(valid, { headers })))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), valid)
  assert.equal(response.headers.get('x-resume-snapshot-hash'), snapshotHash)
  for (const upstream of [
    Response.json(valid, { headers: { ...headers, 'X-Resume-PDF-SHA256': snapshotHash } }),
    Response.json({ ...valid, available: false }, { headers }),
    Response.json({ ...valid, file: '../private.tex' }, { headers }),
    Response.json({ ...valid, locations: [{ page: 1, x: -1, y: 1, width: 1, height: 1 }] }, { headers }),
  ]) await failure(await handleLatexProxy(req(), { action: 'sync' }, dependencies(async () => upstream)), 502)
})
