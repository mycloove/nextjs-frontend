import assert from 'node:assert/strict'
import test from 'node:test'
import { Script, runInNewContext } from 'node:vm'
import {
  BROWSER_ENGINE_VERSION, BROWSER_TEX_ENDPOINT, BrowserEngineError, createBrowserXeTeXEngine,
  type BrowserEngineDependencies, type BrowserEngineFile, type BrowserEngineWorker,
} from './browserEngine.ts'
import { LATEX_LIMITS } from './types.ts'

const encode = (value: string) => new TextEncoder().encode(value)
const pdfBytes = () => encode('%PDF-1.5\nsynthetic protocol fixture\n%%EOF\n').buffer
const xdvBytes = () => new Uint8Array([247, 7, ...new Array(20).fill(0)]).buffer
const hashes = [
  '9b21d12b1d1885e515e075125d72854283d689597e718aa83a19d8ab2280c0a0',
  'c21314edabb2d4a059dc761baddf99f7559e4146189a899cf59aa7c065f95790',
  'abd9ab0356f245daac0f55616ac4df52c308be38803483ab0439873ce4fd87b1',
  '4a14cc6fe0e94cd445c1c1ac12cabec75f3f875b670527806da89fdadec5ca96',
  'fecae874377a2f7cb31811e41edabbda1e19f762d00630a8faa9fb12043b5e5f',
]
const input = () => ({ mainFile: 'src/main.tex', files: [{ path: 'src/main.tex', data: 'RAW ORIGINAL SOURCE MUST NEVER APPEAR IN JS OR REQUESTS' }] })
type Message = Record<string, unknown>
type Options = {
  corrupt?: boolean; oversized?: string; stall?: boolean; crash?: boolean; createFailure?: boolean
  initReply?: Message
  reply?: (kind: 'xetex' | 'pdf', id: number) => Message
}

function fixture(options: Options = {}) {
  const requests: { url: string; init: RequestInit }[] = []
  const blobs: Blob[] = [], revoked: string[] = [], order: string[] = []
  const workers: MockWorker[] = []
  class MockWorker implements BrowserEngineWorker {
    onmessage: BrowserEngineWorker['onmessage'] = null
    onerror: BrowserEngineWorker['onerror'] = null
    onmessageerror: BrowserEngineWorker['onmessageerror'] = null
    messages: Message[] = []
    terminated = 0
    stopped = false
    kind: 'xetex' | 'pdf'
    constructor() { this.kind = workers.length % 2 === 0 ? 'xetex' : 'pdf'; workers.push(this) }
    send(data: Message) { queueMicrotask(() => { if (!this.stopped) this.onmessage?.({ data } as MessageEvent<unknown>) }) }
    postMessage(message: unknown, transfer: Transferable[] = []) {
      const value = structuredClone(message, { transfer }) as Message
      this.messages.push(value)
      if (value.type === 'init') this.send(options.initReply ?? { type: 'ready', kind: this.kind, version: BROWSER_ENGINE_VERSION })
      else if (options.crash) queueMicrotask(() => this.onerror?.({ preventDefault() {} } as ErrorEvent))
      else if (!options.stall) {
        if (this.kind === 'xetex') this.send({ type: 'progress', id: value.id, stage: 'bibliography', message: 'Running classic BibTeX.' })
        this.send(options.reply?.(this.kind, value.id as number) ?? { type: 'result', id: value.id, data: this.kind === 'xetex' ? xdvBytes() : pdfBytes(), log: this.kind === 'xetex' ? 'FULL MAIN.LOG\nMissing character: synthetic diagnostic' : 'xdvipdfmx complete' })
      }
    }
    async terminate() {
      this.terminated++
      await Promise.resolve()
      this.stopped = true; order.push(`stopped:${this.kind}`)
    }
  }
  // Protocol fixtures deliberately inject a fake digest and workers. Actual WASM/PDF
  // compilation is verified separately in the disposable Node smoke, never claimed here.
  const dependencies: BrowserEngineDependencies = {
    async fetch(url, init) {
      requests.push({ url, init })
      const index = url.endsWith('swiftlatexxetex.js') ? 0 : url.endsWith('swiftlatexxetex.wasm') ? 1 : url.endsWith('swiftlatexdvipdfm.js') ? 2 : url.endsWith('swiftlatexdvipdfm.wasm') ? 3 : 4
      return new Response(encode(`//${index + 1}\nvar Module={};`), { headers: options.oversized && url.endsWith(options.oversized) ? { 'content-length': String(40 * 1024 * 1024) } : {} })
    },
    crypto: { subtle: { async digest(_algorithm: string, bytes: ArrayBuffer) {
      const marker = new Uint8Array(bytes)[2] - 49
      return (options.corrupt ? new Uint8Array(32) : new Uint8Array(hashes[marker].match(/../g)!.map((part) => parseInt(part, 16)))).buffer
    } } as unknown as SubtleCrypto },
    createObjectURL(blob) { blobs.push(blob); return `blob:fixture-${blobs.length}` },
    revokeObjectURL(url) { revoked.push(url) },
    createWorker() {
      if (options.createFailure) throw new Error('CSP')
      if (workers.length % 2 === 1) assert.equal(workers.at(-1)!.stopped, true, 'XeTeX must finish termination before PDF worker creation')
      order.push(`created:${workers.length % 2 === 0 ? 'xetex' : 'pdf'}`)
      return new MockWorker()
    },
  }
  const engine = createBrowserXeTeXEngine(dependencies)
  return { engine, dependencies, requests, blobs, revoked, workers, order }
}

test('availability verifies and caches only five public assets without initializing any worker', async () => {
  const f = fixture()
  await f.engine.checkBrowserEngineAvailability()
  await f.engine.checkBrowserEngineAvailability()
  assert.equal(f.requests.length, 5)
  assert.equal(f.workers.length, 0)
  assert.equal(f.blobs.length, 0)
  assert.ok(f.requests.some(({ url }) => url === `${BROWSER_TEX_ENDPOINT}xetex/10/swiftlatexxetex.fmt`))
  for (const { url, init } of f.requests) {
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined)
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.referrerPolicy, 'no-referrer')
    assert.ok(url.includes('de27ed3b31a2735ea749eb523a6786578cbf4c24') || url.startsWith(BROWSER_TEX_ENDPOINT))
  }
})

test('real pipeline protocol runs three Xe passes and a fresh converter, preserving all original source/assets', async () => {
  const f = fixture(), stages: string[] = []
  const font = Buffer.from([0, 1, 2, 3])
  const original = { ...input(), files: [...input().files, { path: 'fonts/Bengali.ttf', data: font }, { path: 'images/photo.png', data: new Uint8Array([137, 80, 78, 71]) }] }
  const pending = f.engine.compileBrowserXeTeX({ ...original, onProgress: (progress) => stages.push(progress.stage) })
  original.files[0].data = 'MUTATED AFTER CAPTURE'; font.fill(9)
  const result = await pending
  assert.equal(new TextDecoder().decode(result.pdf), new TextDecoder().decode(pdfBytes()))
  assert.match(result.log, /FULL MAIN.LOG/); assert.match(result.log, /Missing character:/)
  assert.equal(f.workers.length, 2)
  assert.deepEqual(f.workers[0].messages.filter((message) => message.type === 'run').map((message) => message.id), [1, 2, 3])
  assert.deepEqual(f.workers[1].messages.filter((message) => message.type === 'run').map((message) => message.id), [1])
  for (const worker of f.workers) {
    const files = worker.messages[0].files as BrowserEngineFile[]
    assert.equal(files[0].data, input().files[0].data)
    assert.deepEqual(files.find((file) => file.path === 'fonts/Bengali.ttf')!.data, new Uint8Array([0, 1, 2, 3]))
    assert.equal(worker.terminated, 1)
  }
  assert.deepEqual(f.order, ['created:xetex', 'stopped:xetex', 'created:pdf', 'stopped:pdf'])
  assert.equal(f.revoked.length, 2)
  assert.ok(stages.includes('loading') && stages.includes('compiling') && stages.includes('bibliography') && stages.includes('converting'))
  for (const blob of f.blobs) {
    const source = await blob.text()
    assert.doesNotThrow(() => new Script(source), 'generated classic-worker source must parse')
    assert.ok(!source.includes(input().files[0].data))
    assert.match(source, /SPDX-License-Identifier: AGPL-3.0-or-later/)
    assert.match(source, /wasmBinary:new Uint8Array\(boot.wasm\)/)
    assert.match(source, /Source uploads are not permitted/)
    assert.match(source, /unsafe cache filename/)
    assert.match(source, /\.log/)
  }
  await f.engine.checkBrowserEngineAvailability()
  assert.equal(f.requests.length, 5, 'transferring WASM/format must not detach cached public bytes')
})

test('each subsequent compilation has fresh workers and never caches private source', async () => {
  const f = fixture()
  await f.engine.compileBrowserXeTeX(input())
  await f.engine.compileBrowserXeTeX({ mainFile: 'different.tex', files: [{ path: 'different.tex', data: 'NEW SOURCE' }] })
  assert.equal(f.workers.length, 4); assert.equal(f.requests.length, 5)
  assert.deepEqual((f.workers[2].messages[0].files as BrowserEngineFile[]).map((file) => file.path), ['different.tex'])
})

test('worker dependency adapter permits only credential-free GETs and safe cache filenames', async () => {
  const f = fixture()
  await f.engine.compileBrowserXeTeX(input())
  class NativeRequest {
    withCredentials = true
    timeout = 0
    responseURL = ''
    response = new ArrayBuffer(1)
    headers: Record<string, string | null> = { fileid: 'article.cls', fontid: null }
    sent = false
    open(method: string, url: string, asynchronous?: boolean) {
      assert.equal(method, 'GET'); assert.equal(asynchronous, false); this.responseURL = url
    }
    getResponseHeader(name: string) { return this.headers[name] ?? null }
    send() { this.sent = true }
  }
  const self = { postMessage() {}, XMLHttpRequest: NativeRequest, onmessage: undefined as undefined | ((event: { data: unknown }) => void), fetch: undefined as undefined | ((url: string, options?: RequestInit) => Promise<Response>) }
  runInNewContext(await f.blobs[0].text(), { self, ArrayBuffer, Uint8Array, TextEncoder, TextDecoder, URL, Response, cwrap: () => () => 0 })
  self.onmessage!({ data: { type: 'init', mainFile: 'main.tex', files: [], wasm: new ArrayBuffer(8), format: new ArrayBuffer(8), deadline: Date.now() + 5000 } })
  const request = new self.XMLHttpRequest()
  assert.doesNotThrow(() => request.open('GET', `${BROWSER_TEX_ENDPOINT}xetex/26/article.cls`, false))
  assert.equal(request.getResponseHeader('fontid'), null, 'missing unrelated headers are valid native XHR behavior')
  assert.throws(() => request.open('POST', `${BROWSER_TEX_ENDPOINT}xetex/26/article.cls`), /dependency GET/)
  assert.throws(() => request.open('GET', 'https://evil.invalid/xetex/26/article.cls'), /dependency GET/)
  assert.throws(() => (request.send as (body?: unknown) => void)('PRIVATE SOURCE BODY'), /Source uploads/)
  request.send()
  assert.equal(request.withCredentials, false); assert.equal(request.sent, true)
  for (const unsafe of ['../main.tex', '..', '/main.tex', 'C:main.tex', '\\main.tex', '\0main.tex']) {
    request.headers.fileid = unsafe
    assert.throws(() => request.getResponseHeader('fileid'), /unsafe cache filename/)
  }
  request.responseURL = 'https://evil.invalid/file'
  assert.throws(() => request.send(), /redirected outside/)
  const wasm = await self.fetch!('swiftlatexxetex.wasm')
  assert.equal(wasm.headers.get('content-type'), 'application/wasm')
  assert.deepEqual(new Uint8Array(await wasm.arrayBuffer()), new Uint8Array(8))
  await assert.rejects(self.fetch!('https://evil.invalid/engine.wasm'), /already-verified WASM/)
  await assert.rejects(self.fetch!('swiftlatexxetex.wasm', { method: 'POST', body: 'PRIVATE SOURCE' }), /already-verified WASM/)
})

test('unverified artifacts fail before executing any worker', async () => {
  const f = fixture({ corrupt: true })
  await assert.rejects(f.engine.checkBrowserEngineAvailability(), { code: 'browser_artifact_integrity' })
  assert.equal(f.workers.length, 0); assert.equal(f.blobs.length, 0)
})

test('JS, WASM and format downloads all enforce their public byte bounds', async () => {
  for (const oversized of ['swiftlatexxetex.js', 'swiftlatexxetex.wasm', 'swiftlatexxetex.fmt']) {
    const f = fixture({ oversized })
    await assert.rejects(f.engine.checkBrowserEngineAvailability(), { code: 'browser_artifact_unavailable' })
    assert.equal(f.workers.length, 0)
  }
})

test('unsafe, duplicate, oversized and unsupported inputs are rejected before networking', async () => {
  const f = fixture()
  const cases = [
    { mainFile: '../main.tex', files: [{ path: '../main.tex', data: '' }] },
    { mainFile: 'main.tex', files: [{ path: 'main.tex', data: '\ud800' }] },
    { mainFile: 'main.tex', files: [{ path: 'main.tex', data: 'x'.repeat(LATEX_LIMITS.sourceBytes + 1) }] },
    { mainFile: 'main.tex', files: [{ path: 'main.tex', data: '' }, { path: 'Main.tex', data: '' }] },
    { mainFile: 'main.tex', files: [{ path: 'main.tex', data: '' }, { path: 'main.tex/part.tex', data: '' }] },
    { mainFile: 'main.tex', files: [{ path: 'main.tex', data: '' }, { path: '__smilepdf_output.xdv', data: xdvBytes() }] },
    { mainFile: 'main.tex', files: [{ path: 'main.tex', data: '' }, { path: 'photo.png', data: 'not binary' }] },
    { mainFile: 'main.tex', files: [{ path: 'main.tex', data: '' }, { path: 'font.ttf', data: new Uint8Array(16 * 1024 * 1024 + 1) }] },
    { mainFile: 'main.tex', files: new Array(LATEX_LIMITS.files + 1).fill({ path: 'main.tex', data: '' }) },
    { mainFile: 'main.tex', files: [{ path: 'main.tex', data: '' }, { path: '__smilepdf_output.tex', data: '' }] },
    { mainFile: 'main.tex', files: [{ path: 'main.tex', data: '' }, { path: 'swiftlatexxetex.fmt/part.tex', data: '' }] },
    { mainFile: 'main.tex', files: [{ path: 'main.tex', data: '' }, { path: 'main.log/part.tex', data: '' }] },
    { mainFile: 'main.tex', files: [{ path: 'main.tex', data: '' }, { path: 'font1.ttf', data: new Uint8Array(8 * 1024 * 1024) }, { path: 'font2.ttf', data: new Uint8Array(8 * 1024 * 1024 + 1) }] },
  ]
  for (const value of cases) await assert.rejects(f.engine.compileBrowserXeTeX(value as Parameters<typeof f.engine.compileBrowserXeTeX>[0]), { code: 'browser_invalid_project' })
  assert.equal(f.requests.length, 0)
})

test('fonts use the separate 16 MiB input budget without relaxing project, PDF or log limits', async () => {
  const f = fixture()
  const files: BrowserEngineFile[] = [{ path: 'main.tex', data: 'source' },
    ...Array.from({ length: LATEX_LIMITS.files - 1 }, (_, index) => ({ path: `part${index}.tex`, data: '' })),
    { path: 'font.ttf', data: new Uint8Array(4 * 1024 * 1024) }]
  await f.engine.compileBrowserXeTeX({ mainFile: 'main.tex', files })
  for (const worker of f.workers) assert.equal((worker.messages[0].files as BrowserEngineFile[]).find((file) => file.path === 'font.ttf')!.data.length, 4 * 1024 * 1024)
  const tooManyFonts = [{ path: 'main.tex', data: '' }, ...Array.from({ length: 17 }, (_, index) => ({ path: `font${index}.ttf`, data: new Uint8Array([1]) }))]
  await assert.rejects(f.engine.compileBrowserXeTeX({ mainFile: 'main.tex', files: tooManyFonts }), { code: 'browser_invalid_project' })
})

test('worker failure retains the full diagnostic log and never converts a failed Xe pass', async () => {
  const f = fixture({ reply: (_kind, id) => ({ type: 'failure', id, code: 'browser_compile_failed', message: 'Undefined control sequence', log: '! Undefined control sequence\nl.7 ORIGINAL MACRO\nMissing character: Bangla' }) })
  await assert.rejects(f.engine.compileBrowserXeTeX(input()), (cause: unknown) => cause instanceof BrowserEngineError && cause.log.includes('l.7 ORIGINAL MACRO') && cause.log.includes('Missing character:'))
  assert.equal(f.workers.length, 1); assert.equal(f.workers[0].terminated, 1)
})

test('worker messages require exact protocol, bounded logs, matching IDs and ArrayBuffer bytes', async () => {
  for (const reply of [
    { type: 'result', id: 999, data: xdvBytes(), log: '' },
    { type: 'result', id: 1, data: new Uint8Array(20), log: '' },
    { type: 'result', id: 1, data: xdvBytes(), log: 'x'.repeat(LATEX_LIMITS.logBytes + 1) },
    { type: 'result', id: 1, data: xdvBytes(), log: '', extra: true },
    { type: 'failure', id: 1, code: 'invented', message: 'bad', log: '' },
  ]) {
    const f = fixture({ reply: () => reply })
    await assert.rejects(f.engine.compileBrowserXeTeX(input()), { code: 'browser_protocol_error' })
    assert.equal(f.workers.length, 1); assert.equal(f.workers[0].terminated, 1)
  }
})

test('initialization rejects wrong engine/version and leaked native filesystem acknowledgments', async () => {
  for (const initReply of [
    { type: 'ready', kind: 'pdf', version: BROWSER_ENGINE_VERSION },
    { type: 'ready', kind: 'xetex', version: 'wrong-artifact-version' },
    { result: 'ok' },
    { cmd: 'writefile', result: 'ok' },
    { cmd: 'mkdir', result: 'failed' },
  ]) {
    const f = fixture({ initReply })
    await assert.rejects(f.engine.compileBrowserXeTeX(input()), { code: 'browser_protocol_error' })
    assert.equal(f.workers.length, 1); assert.equal(f.workers[0].terminated, 1)
    assert.equal(f.workers[0].messages.length, 1)
  }
})

test('XDV is never treated as PDF, and output byte caps cannot be bypassed by a worker', async () => {
  const cases: { reply: Options['reply']; code: string }[] = [
    { reply: (_kind, id) => ({ type: 'result', id, data: pdfBytes(), log: '' }), code: 'browser_invalid_xdv' },
    { reply: (kind, id) => ({ type: 'result', id, data: kind === 'xetex' ? xdvBytes() : xdvBytes(), log: '' }), code: 'browser_invalid_pdf' },
    { reply: (kind, id) => ({ type: 'result', id, data: kind === 'xetex' ? xdvBytes() : new ArrayBuffer(LATEX_LIMITS.pdfBytes + 1), log: '' }), code: 'browser_invalid_pdf' },
    { reply: (_kind, id) => ({ type: 'result', id, data: new ArrayBuffer(LATEX_LIMITS.syncBytes + 1), log: '' }), code: 'browser_invalid_xdv' },
    { reply: (kind, id) => ({ type: 'result', id, data: kind === 'xetex' ? xdvBytes() : pdfBytes(), log: 'x'.repeat(LATEX_LIMITS.logBytes) }), code: 'browser_log_limit' },
  ]
  for (const value of cases) {
    const f = fixture(value)
    await assert.rejects(f.engine.compileBrowserXeTeX(input()), { code: value.code })
    assert.ok(f.workers.every((worker) => worker.terminated === 1))
  }
})

test('cancellation and timeout truly terminate workers with no automatic retry', async () => {
  const cancelled = fixture({ stall: true }), controller = new AbortController()
  const pending = cancelled.engine.compileBrowserXeTeX({ ...input(), signal: controller.signal, onProgress: ({ stage }) => { if (stage === 'compiling') queueMicrotask(() => controller.abort()) } })
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(cancelled.workers.length, 1); assert.equal(cancelled.workers[0].terminated, 1)
  const timed = fixture({ stall: true })
  const engine = createBrowserXeTeXEngine({ ...timed.dependencies, timeoutMs: 50 })
  await assert.rejects(engine.compileBrowserXeTeX(input()), { code: 'browser_timeout' })
  assert.equal(timed.workers.length, 1); assert.equal(timed.workers[0].terminated, 1)
  assert.equal(timed.revoked.length, 1)
})

test('already-aborted calls do no work and worker/CSP failures revoke their blob', async () => {
  const aborted = fixture(), controller = new AbortController(); controller.abort()
  await assert.rejects(aborted.engine.compileBrowserXeTeX({ ...input(), signal: controller.signal }), { name: 'AbortError' })
  await assert.rejects(aborted.engine.checkBrowserEngineAvailability(controller.signal), { name: 'AbortError' })
  assert.equal(aborted.requests.length, 0)
  const csp = fixture({ createFailure: true })
  await assert.rejects(csp.engine.compileBrowserXeTeX(input()), { code: 'browser_unavailable' })
  assert.equal(csp.revoked.length, 1)
  const crash = fixture({ crash: true })
  await assert.rejects(crash.engine.compileBrowserXeTeX(input()), { code: 'browser_engine_crashed' })
  assert.equal(crash.workers[0].terminated, 1)
})
