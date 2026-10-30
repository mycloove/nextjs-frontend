import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import { createLatexCompileTransport, LatexTransportError } from '../compileTransport.ts'
import { LATEX_API, LATEX_LIMITS, type LatexCompileManifest, type LatexCompileResult, type LatexProject } from '../types.ts'
import { compareLatexPaths } from './contract.ts'
import { handleLatexProxy, type LatexProxyRoute } from './proxy.ts'

const operationKey = 'compile-operation-7'
const now = '2026-10-29T09:00:00Z'
const pdf = new TextEncoder().encode('%PDF-1.7\n% original-byte transport contract fixture\n%%EOF\n')
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const pdfHash = sha256(pdf)

function project(overrides: Partial<LatexProject> = {}): LatexProject {
  return { version: 1, id: 'project-one', title: 'My resume', revision: 7, mainFile: 'resume.tex', engine: 'lualatex', files: [{ id: 'main', path: 'resume.tex', content: '\\documentclass{article}\r\n% \u09ac\u09be\u0982\u09b2\u09be \u200d\u200c e\u0301\n' }], assets: [], templateId: null, templateVersion: null, createdAt: now, updatedAt: now, ...overrides }
}

function json(input: unknown, init: RequestInit, status = 200, extra: HeadersInit = {}) {
  const headers = new Headers(extra)
  headers.set('X-Request-Id', new Headers(init.headers).get('x-request-id')!)
  return Response.json(input, { status, headers })
}

function artifact(init: RequestInit, data: Uint8Array<ArrayBuffer> = pdf, extra: HeadersInit = {}) {
  const headers = new Headers({ 'Content-Type': 'application/pdf', 'X-Resume-PDF-SHA256': pdfHash, 'X-Request-Id': new Headers(init.headers).get('x-request-id')! })
  new Headers(extra).forEach((value, key) => headers.set(key, value))
  return new Response(data, { headers })
}

async function uploaded(init: RequestInit) {
  assert.ok(init.body instanceof ArrayBuffer)
  const fields = await new Response(init.body, { headers: init.headers }).formData()
  const manifest = JSON.parse(String(fields.get('manifest'))) as LatexCompileManifest
  const assets = []
  for (const asset of manifest.assets) {
    const bytes = new Uint8Array(await (fields.get(`asset:${asset.id}`) as Blob).arrayBuffer())
    assets.push({ ...asset, sha256: sha256(bytes) })
  }
  // Independent contract serialization; code-point sorting is checked separately against a fixed order.
  const canonical = JSON.stringify({ version: manifest.version, projectId: manifest.projectId, revision: manifest.revision, mainFile: manifest.mainFile, engine: manifest.engine, files: [...manifest.files].sort(compareLatexPaths), assets: assets.sort(compareLatexPaths) })
  const result: LatexCompileResult = { status: 'ready', operationKey: manifest.operationKey, projectId: manifest.projectId, revision: manifest.revision, snapshotHash: sha256(canonical), engine: manifest.engine, profileVersion: 'resume-tex-unit-profile', pdf: { id: 'artifact-one', sha256: pdfHash, bytes: pdf.length, pages: 1 }, diagnostics: [], log: '', syncAvailable: true, createdAt: now }
  return { manifest, fields, result }
}

async function rejects(action: Promise<unknown>, code: string, status?: number) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof LatexTransportError)
    assert.equal(error.code, code)
    if (status !== undefined) assert.equal(error.status, status)
    assert.ok(error.request_id)
    return true
  })
}

test('creating the transport starts no automatic capability/compile calls or timers', async () => {
  let calls = 0
  const transport = createLatexCompileTransport({ request: async () => { calls++; assert.fail('Import must not request anything'); return Response.json({}) } })
  assert.equal(typeof transport.compileLatexProject, 'function')
  await setImmediate()
  assert.equal(calls, 0)
})

test('full original multipart, explicit feature IDs and same-origin no-cache requests produce a hash-verified canonical proof', async () => {
  const original = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 99])
  const source = project({ assets: [{ id: 'photo', path: 'assets/photo.png', mediaType: 'image/png', blob: new Blob([original], { type: 'image/png' }) }] })
  let requests = 0
  let compileId = ''
  const transport = createLatexCompileTransport({ request: async (url, init) => {
    requests++
    const headers = new Headers(init.headers)
    assert.match(headers.get('x-request-id')!, /^latex-[a-z0-9-]+$/)
    assert.equal(headers.get('x-resume-operation-key'), operationKey)
    assert.equal(headers.get('x-resume-internal-key'), null)
    assert.equal(headers.get('x-resume-principal'), null)
    assert.equal(headers.get('x-credit-cost'), null)
    assert.equal(init.credentials, 'same-origin')
    assert.equal(init.cache, 'no-store')
    assert.equal(init.redirect, 'error')
    assert.ok(init.signal instanceof AbortSignal)
    if (url === `${LATEX_API}/compile`) {
      compileId = headers.get('x-request-id')!
      assert.equal(init.method, 'POST')
      const { manifest, fields, result } = await uploaded(init)
      assert.equal(manifest.files[0].content, source.files[0].content)
      assert.equal(manifest.revision, source.revision)
      assert.equal(manifest.assets[0].size, original.length)
      assert.deepEqual(new Uint8Array(await (fields.get('asset:photo') as Blob).arrayBuffer()), original)
      // Independently calculated with Python 3.11 json.dumps(ensure_ascii=False, separators=(',', ':')).
      assert.equal(result.snapshotHash, '485563523cce7bb5b37491180005fb568a5406a807f16e58159d481ae271bc10')
      assert.ok((init.body as ArrayBuffer).byteLength <= LATEX_LIMITS.uploadBytes)
      return json(result, init)
    }
    assert.equal(url, `${LATEX_API}/artifacts/artifact-one`)
    assert.notEqual(headers.get('x-request-id'), compileId)
    assert.equal(init.method, 'GET')
    return artifact(init)
  } })
  const proof = await transport.compileLatexProject(source, operationKey, new AbortController().signal)
  assert.equal(requests, 2)
  assert.equal(proof.pdf.sha256, pdfHash)
  assert.deepEqual(new Uint8Array(proof.data), pdf)
  const viewerCopy = proof.data.slice(0)
  structuredClone(viewerCopy, { transfer: [viewerCopy] })
  assert.equal(viewerCopy.byteLength, 0)
  assert.equal(proof.data.byteLength, pdf.length)
  assert.equal(sha256(new Uint8Array(proof.data)), pdfHash)
  assert.equal(source.files[0].content, project().files[0].content)
})

test('source/asset snapshot is immutable across awaits and late ready results never replace current writing', async () => {
  const source = project({ assets: [{ id: 'photo', path: 'photo.png', mediaType: 'image/png', blob: new Blob(['123'], { type: 'image/png' }) }] })
  const initialContent = source.files[0].content
  const transport = createLatexCompileTransport({ request: async (url, init) => {
    if (url.endsWith('/compile')) {
      const { manifest, result } = await uploaded(init)
      source.revision = 8
      source.files[0].content = 'Current writing after compile began'
      assert.equal(manifest.files[0].content, initialContent)
      return json(result, init)
    }
    return artifact(init)
  } })
  const proof = await transport.compileLatexProject(source, operationKey)
  assert.equal(proof.revision, 7)
  assert.equal(source.revision, 8)
  assert.equal(source.files[0].content, 'Current writing after compile began')
})

test('canonical path ordering is Unicode code-point ordinal, not locale or UTF-16 ordering', async () => {
  const paths = [{ path: '\ud840\udc00.tex' }, { path: '\uff21.tex' }, { path: 'resume.tex' }]
  assert.deepEqual(paths.sort(compareLatexPaths).map((item) => item.path), ['resume.tex', '\uff21.tex', '\ud840\udc00.tex'])
  const source = project({ files: [...project().files, { id: 'supplementary', path: '\ud840\udc00.tex', content: 'unchanged' }, { id: 'fullwidth', path: '\uff21.tex', content: 'exact\r\n' }] })
  const transport = createLatexCompileTransport({ request: async (url, init) => url.endsWith('/compile') ? json((await uploaded(init)).result, init) : artifact(init) })
  assert.equal((await transport.compileLatexProject(source, operationKey)).revision, 7)
})

test('local invalid manifests fail before any upload, including source and complete multipart limits', async () => {
  let calls = 0
  const transport = createLatexCompileTransport({ request: async () => { calls++; assert.fail('Invalid project must not upload'); return Response.json({}) } })
  await rejects(transport.compileLatexProject(project({ mainFile: 'missing.tex' }), operationKey), 'invalid_main_file', 400)
  await rejects(transport.compileLatexProject(project(), '../escape'), 'invalid_identifier', 400)
  await rejects(transport.compileLatexProject(project({ files: [{ id: 'main', path: '../resume.tex', content: '' }] }), operationKey), 'invalid_path', 400)
  await rejects(transport.compileLatexProject(project({ files: [{ id: 'main', path: 'resume.tex', content: '\ud800' }] }), operationKey), 'invalid_manifest', 400)
  await rejects(transport.compileLatexProject(project({ files: [{ id: 'main', path: 'resume.tex', content: 'x'.repeat(LATEX_LIMITS.sourceBytes + 1) }] }), operationKey), 'payload_too_large', 413)
  await rejects(transport.compileLatexProject(project({ files: [{ id: 'main', path: 'resume.tex', content: '' }], assets: [{ id: 'large', path: 'large.png', mediaType: 'image/png', blob: new Blob([new Uint8Array(LATEX_LIMITS.uploadBytes - 16)], { type: 'image/png' }) }] }), operationKey), 'payload_too_large', 413)
  assert.equal(calls, 0)
})

test('mismatched compile identity/source hashes are rejected before artifact fetch', async () => {
  for (const changed of [{ revision: 8 }, { projectId: 'other-project' }, { operationKey: 'other-operation' }, { engine: 'xelatex' }, { snapshotHash: 'a'.repeat(64) }]) {
    let calls = 0
    const transport = createLatexCompileTransport({ request: async (url, init) => {
      calls++
      assert.equal(url, `${LATEX_API}/compile`)
      return json({ ...(await uploaded(init)).result, ...changed }, init)
    } })
    await rejects(transport.compileLatexProject(project(), operationKey), 'result_mismatch', 502)
    assert.equal(calls, 1)
  }
})

test('result output limits and safe diagnostic paths are checked before artifact acceptance', async () => {
  const variants = [
    { pdf: { id: 'artifact-one', sha256: pdfHash, bytes: pdf.length, pages: 33 } },
    { pdf: { id: 'artifact-one', sha256: pdfHash, bytes: LATEX_LIMITS.pdfBytes + 1, pages: 1 } },
    { log: 'x'.repeat(LATEX_LIMITS.logBytes + 1) },
    { diagnostics: [{ severity: 'error', message: 'unsafe', file: '/server/private.tex' }] },
    { diagnostics: [{ severity: 'warning', message: 'outside', file: 'outside.tex' }] },
  ]
  for (const changed of variants) {
    const transport = createLatexCompileTransport({ request: async (url, init) => {
      assert.equal(url, `${LATEX_API}/compile`)
      return json({ ...(await uploaded(init)).result, ...changed }, init)
    } })
    await rejects(transport.compileLatexProject(project(), operationKey), 'upstream_protocol_error', 502)
  }
})

test('artifact MIME, observed size, header hash and actual SHA-256 must all match the manifest', async () => {
  for (const mode of ['mime', 'header', 'bytes', 'size', 'oversize', 'not-pdf']) {
    const transport = createLatexCompileTransport({ request: async (url, init) => {
      if (url.endsWith('/compile')) {
        const { result } = await uploaded(init)
        if (mode === 'size') result.pdf.bytes++
        if (mode === 'not-pdf') result.pdf.sha256 = sha256('not a PDF')
        return json(result, init)
      }
      if (mode === 'mime') return artifact(init, pdf, { 'Content-Type': 'text/html' })
      if (mode === 'header') return artifact(init, pdf, { 'X-Resume-PDF-SHA256': 'a'.repeat(64) })
      if (mode === 'bytes') { const altered = pdf.slice(); altered[altered.length - 1] = 0; return artifact(init, altered) }
      if (mode === 'oversize') return artifact(init, new Uint8Array(LATEX_LIMITS.pdfBytes + 1), { 'Content-Length': '1' })
      if (mode === 'not-pdf') return artifact(init, new TextEncoder().encode('not a PDF'), { 'X-Resume-PDF-SHA256': sha256('not a PDF') })
      return artifact(init)
    } })
    await rejects(transport.compileLatexProject(project(), operationKey), 'artifact_hash_mismatch', 502)
  }
})

test('typed TeX refusal keeps diagnostics/log/code/request/operation and never auto-retries', async () => {
  let calls = 0
  const diagnostic = { severity: 'error', message: 'Undefined control sequence.', file: 'resume.tex', line: 5, code: 'tex_error', help: 'Check this command.' }
  const transport = createLatexCompileTransport({ request: async (_url, init) => {
    calls++
    return json({ error: 'TeX refused this snapshot.', code: 'compile_refused', request_id: new Headers(init.headers).get('x-request-id'), operationKey, diagnostics: [diagnostic], log: 'resume.tex:5: Undefined control sequence' }, init, 422)
  } })
  await assert.rejects(transport.compileLatexProject(project(), operationKey), (error: unknown) => {
    assert.ok(error instanceof LatexTransportError)
    assert.equal(error.status, 422)
    assert.equal(error.retryable, false)
    assert.equal(error.operationKey, operationKey)
    assert.deepEqual(error.diagnostics, [diagnostic])
    assert.equal(error.log, 'resume.tex:5: Undefined control sequence')
    return true
  })
  assert.equal(calls, 1)
})

test('fair-use failures expose bounded retry details, not a credit/catalog change', async () => {
  const transport = createLatexCompileTransport({ now: () => Date.parse(now), request: async (_url, init) => json({ error: 'Free compile fair-use limit reached.', code: 'rate_limited', request_id: new Headers(init.headers).get('x-request-id'), operationKey }, init, 429, { 'Retry-After': 'Thu, 29 Oct 2026 09:01:30 GMT' }) })
  await assert.rejects(transport.compileLatexProject(project(), operationKey), (error: unknown) => {
    assert.ok(error instanceof LatexTransportError)
    assert.equal(error.retryable, true)
    assert.equal(error.retryAfterSeconds, 90)
    assert.equal(error.status, 429)
    return true
  })
})

test('late JSON/error/artifact stream failures are typed transport failures, not successful or deterministic TeX outcomes', async () => {
  for (const action of ['operation', 'refusal', 'artifact']) {
    const transport = createLatexCompileTransport({ request: async (url, init) => {
      if (action === 'artifact' && url.endsWith('/compile')) return json((await uploaded(init)).result, init)
      const headers = new Headers({ 'X-Request-Id': new Headers(init.headers).get('x-request-id')!, 'Content-Type': action === 'artifact' ? 'application/pdf' : 'application/json', ...(action === 'artifact' ? { 'X-Resume-PDF-SHA256': pdfHash } : {}) })
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([123])); queueMicrotask(() => controller.error(new TypeError('private late connection failure'))) } }), { status: action === 'refusal' ? 422 : 200, headers })
    } })
    const promise = action === 'operation' ? transport.getLatexOperation(operationKey) : transport.compileLatexProject(project(), operationKey)
    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof LatexTransportError)
      assert.equal(error.code, 'transport_unavailable')
      assert.equal(error.retryable, true)
      assert.doesNotMatch(error.message, /private late connection/)
      return true
    })
  }
})

test('stalled body timeout and aborted/late request promises do not acknowledge cancellation or leak late rejections', async () => {
  let cancelled = false
  const timed = createLatexCompileTransport({ timeoutMs: 5, request: async (_url, init) => new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { 'Content-Type': 'application/json', 'X-Request-Id': new Headers(init.headers).get('x-request-id')! } }) })
  await rejects(timed.getLatexOperation(operationKey), 'upstream_timeout', 504)
  assert.equal(cancelled, true)

  let enter!: () => void
  let lateReject!: (error: unknown) => void
  const entered = new Promise<void>((resolve) => { enter = resolve })
  const pending = new Promise<Response>((_resolve, reject) => { lateReject = reject })
  const aborted = createLatexCompileTransport({ request: async () => { enter(); return pending } })
  const controller = new AbortController()
  const waiting = aborted.cancelLatexCompile(operationKey, controller.signal)
  await entered
  controller.abort()
  await rejects(waiting, 'request_aborted', 408)
  lateReject(new Error('late ignored request rejection'))
  await setImmediate()
})

test('get operation is explicit DTO-only recovery; cancellation requires an acknowledged terminal state', async () => {
  let count = 0
  const transport = createLatexCompileTransport({ request: async (url, init) => {
    count++
    if (url.includes('/operations/')) return json({ status: 'running', operationKey }, init)
    assert.equal(url, `${LATEX_API}/cancel`)
    return json({ cancelled: false, status: 'running' }, init)
  } })
  assert.deepEqual(await transport.getLatexOperation(operationKey), { status: 'running', operationKey })
  assert.deepEqual(await transport.cancelLatexCompile(operationKey), { cancelled: false, status: 'running' })
  assert.equal(count, 2)
  const dishonest = createLatexCompileTransport({ request: async (_url, init) => json({ cancelled: true, status: 'running' }, init) })
  await rejects(dishonest.cancelLatexCompile(operationKey), 'upstream_protocol_error', 502)
})

test('sync sends private proof hashes only in the body and accepts no stale/unbound or guessed mappings', async () => {
  const snapshotHash = 'a'.repeat(64)
  const query = { operationKey, snapshotHash, pdfHash, direction: 'forward' as const, file: 'resume.tex', line: 3 }
  const transport = createLatexCompileTransport({ request: async (url, init) => {
    assert.equal(url, `${LATEX_API}/sync`)
    assert.deepEqual(JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer)), query)
    return json({ available: true, locations: [{ page: 1, x: 20, y: 30, width: 120, height: 14 }] }, init, 200, { 'X-Resume-Snapshot-Hash': snapshotHash, 'X-Resume-PDF-SHA256': pdfHash })
  } })
  assert.equal((await transport.syncLatexProof(query)).available, true)
  const stale = createLatexCompileTransport({ request: async (_url, init) => json({ available: false, locations: [] }, init, 200, { 'X-Resume-Snapshot-Hash': snapshotHash, 'X-Resume-PDF-SHA256': snapshotHash }) })
  await rejects(stale.syncLatexProof(query), 'result_mismatch', 502)
  const guessed = createLatexCompileTransport({ request: async (_url, init) => json({ available: false, locations: [{ page: 1, x: 1, y: 1, width: 1, height: 1 }] }, init, 200, { 'X-Resume-Snapshot-Hash': snapshotHash, 'X-Resume-PDF-SHA256': pdfHash }) })
  await rejects(guessed.syncLatexProof(query), 'upstream_protocol_error', 502)
})

test('capability/session/compile/artifact contracts compose through real pure proxy functions without HTTP or Next', async () => {
  const env = {
    MR_RESUME_LATEX_COMPILE_ENABLED: 'true', MR_RESUME_LATEX_SERVICE_URL: 'http://compiler.private:9000',
    MR_RESUME_LATEX_INTERNAL_KEY: 'unit-only-private-compiler-key', MR_RESUME_LATEX_GUEST_SECRET: 'unit-only-a9sE07pV24qK86wZ10nR59dG31tY68mF42cL95uH73',
  }
  const guestId = '75f7b103-2b30-4df1-9a0d-9cb584d1634a'
  let cookie = ''
  let privateCalls = 0
  const transport = createLatexCompileTransport({ request: async (url, init) => {
    const headers = new Headers(init.headers)
    headers.set('Sec-Fetch-Site', 'same-origin')
    headers.set('Sec-Fetch-Mode', 'cors')
    headers.set('Sec-Fetch-Dest', 'empty')
    if (init.method === 'POST') headers.set('Origin', 'https://resume.example')
    if (cookie) headers.set('Cookie', cookie)
    const action = url.slice(LATEX_API.length + 1)
    const route: LatexProxyRoute = action.startsWith('artifacts/') ? { action: 'artifacts', id: action.slice('artifacts/'.length) }
      : { action: action as 'compile' | 'capabilities' }
    const response = await handleLatexProxy(new Request(`https://resume.example${url}`, { ...init, headers }), route, {
      env, now: () => Date.parse(now), randomUUID: () => guestId,
      fetch: async (privateUrl, forwarded) => {
        privateCalls++
        const internal = new Headers(forwarded.headers)
        assert.equal(internal.get('x-resume-internal-key'), env.MR_RESUME_LATEX_INTERNAL_KEY)
        assert.equal(internal.get('x-resume-principal'), guestId)
        assert.equal(internal.get('cookie'), null)
        if (privateUrl.endsWith('/capabilities')) return Response.json({ enabled: true, ready: true, reason: '', profiles: [{ id: 'lualatex', name: 'LuaLaTeX', version: 'resume-tex-unit-profile', fonts: [], packages: [] }], limits: LATEX_LIMITS })
        if (privateUrl.endsWith('/compile')) return Response.json((await uploaded(forwarded)).result)
        assert.equal(privateUrl, 'http://compiler.private:9000/mr-resume-latex/artifacts/artifact-one')
        return artifact(forwarded)
      },
    })
    const issued = response.headers.get('set-cookie')
    if (issued) cookie = issued.split(';')[0]
    return response
  } })
  assert.equal((await transport.getLatexCapabilities()).ready, true)
  assert.match(cookie, /^mr-resume-latex-guest=v1\./)
  const proof = await transport.compileLatexProject(project(), operationKey)
  assert.deepEqual(new Uint8Array(proof.data), pdf)
  assert.equal(privateCalls, 3)
})

test('client capabilities accept truthful unavailable shape and reject unsupported advertised limits/response identities', async () => {
  const unavailable = { enabled: false, ready: false, reason: 'Private compiler disabled.', profiles: [], limits: LATEX_LIMITS }
  const disabled = createLatexCompileTransport({ request: async (_url, init) => json(unavailable, init) })
  assert.deepEqual(await disabled.getLatexCapabilities(), unavailable)
  const tooLarge = createLatexCompileTransport({ request: async (_url, init) => json({ ...unavailable, limits: { ...LATEX_LIMITS, uploadBytes: LATEX_LIMITS.uploadBytes + 1 } }, init) })
  await rejects(tooLarge.getLatexCapabilities(), 'upstream_protocol_error', 502)
  const wrongRequest = createLatexCompileTransport({ request: async () => Response.json(unavailable, { headers: { 'X-Request-Id': 'different-request' } }) })
  await rejects(wrongRequest.getLatexCapabilities(), 'upstream_protocol_error', 502)
})
