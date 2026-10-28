import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { withMicroserviceHeaders } from '../../../lib/usage/internal.ts'

// Exercise the real thin handler without starting Next.js, a database or Flask.
const compiled = ts.transpileModule(readFileSync(new URL('./route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function handler(fetch, { backendUrl, quotaResponse } = {}) {
  const exports = {}
  let applied = 0
  runInNewContext(compiled, {
    exports,
    require(specifier) {
      if (specifier === 'next/server') return { NextResponse: Response }
      if (specifier === '@/lib/usage/internal') return { withMicroserviceHeaders }
      if (specifier === '@/lib/usage/quota') return {
        beginToolQuota: async () => quotaResponse
          ? { ok: false, response: quotaResponse }
          : { ok: true, apply: (response) => { applied++; return response } },
      }
      throw new Error(`Unexpected route dependency: ${specifier}`)
    },
    process: { env: { PDF_MICROSERVICE_URL: backendUrl } },
    fetch,
    AbortController,
    setTimeout,
    clearTimeout,
  })
  return { post: exports.POST, applied: () => applied }
}

function request(body) {
  return new Request('https://example.test/api/bijoy-convert', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function serviceKey(t, key) {
  const previous = process.env.PDF_SERVICE_INTERNAL_KEY
  if (key === undefined) delete process.env.PDF_SERVICE_INTERNAL_KEY
  else process.env.PDF_SERVICE_INTERNAL_KEY = key
  t.after(() => {
    if (previous === undefined) delete process.env.PDF_SERVICE_INTERNAL_KEY
    else process.env.PDF_SERVICE_INTERNAL_KEY = previous
  })
}

test('forwards the configured service key and unchanged text contract', async (t) => {
  serviceKey(t, '  test-internal-key  ')
  const payload = { result: 'converted text', converted: true }
  const route = handler(async (url, init) => {
    assert.equal(url, 'https://processor.example.test/api/bijoy/convert')
    assert.equal(init.method, 'POST')
    assert.equal(new Headers(init.headers).get('x-pdf-service-key'), 'test-internal-key')
    assert.equal(new Headers(init.headers).get('content-type'), 'application/json')
    assert.deepEqual(JSON.parse(init.body), { text: 'legacy text' })
    assert.ok(init.signal instanceof AbortSignal)
    return Response.json(payload)
  }, { backendUrl: 'https://processor.example.test' })
  const response = await route.post(request({ text: 'legacy text', ignored: true }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), payload)
  assert.equal(route.applied(), 1)
})

test('preserves the port-5000 fallback and keyless development mode', async (t) => {
  serviceKey(t, undefined)
  const route = handler(async (url, init) => {
    assert.equal(url, 'http://localhost:5000/api/bijoy/convert')
    assert.equal(new Headers(init.headers).has('x-pdf-service-key'), false)
    return Response.json({ result: 'unchanged', converted: false })
  })
  assert.equal((await route.post(request({ text: 'unchanged' }))).status, 200)
})

test('validates input before contacting the processor', async () => {
  const route = handler(() => { throw new Error('Unexpected upstream request') })
  assert.equal((await route.post(request({ text: 123 }))).status, 400)
  assert.equal((await route.post(request({ text: 'a'.repeat(400_001) }))).status, 413)
  assert.equal((await route.post(new Request('https://example.test', { method: 'POST', body: '{' }))).status, 400)
  assert.equal(route.applied(), 0)
})

test('preserves quota denial without contacting the processor', async () => {
  const blocked = Response.json({ error: 'Limit reached' }, { status: 429 })
  const route = handler(() => { throw new Error('Unexpected upstream request') }, { quotaResponse: blocked })
  assert.equal(await route.post(request({ text: 'legacy text' })), blocked)
  assert.equal(route.applied(), 0)
})

test('preserves upstream errors and applies the existing quota response adapter', async () => {
  const payload = { error: 'Invalid input' }
  const route = handler(async () => Response.json(payload, { status: 422 }))
  const response = await route.post(request({ text: 'legacy text' }))
  assert.equal(response.status, 422)
  assert.deepEqual(await response.json(), payload)
  assert.equal(route.applied(), 1)
})

test('keeps unavailable and non-JSON failures distinct from success', async () => {
  const unavailable = handler(async () => { throw new Error('Connection refused') })
  assert.equal((await unavailable.post(request({ text: 'legacy text' }))).status, 503)
  assert.equal(unavailable.applied(), 1)
  const invalid = handler(async () => new Response('Bad gateway', { status: 502 }))
  assert.equal((await invalid.post(request({ text: 'legacy text' }))).status, 502)
  assert.equal(invalid.applied(), 1)
})
