import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Worker as NodeWorker } from 'node:worker_threads'
import { gunzipSync, gzipSync } from 'node:zlib'
import { degrees, PDFDocument, PDFName, PDFNumber } from 'pdf-lib'
import { createBrowserSyncSession, type BrowserSyncArtifact, type BrowserSyncWorker } from './browserSynctex.ts'
import { createLatexProofNavigation } from './proofNavigation.ts'
import { expandSynctex, openSynctex, SYNCTEX_BYTE_LIMIT, SYNCTEX_RECORD_LIMIT, synctexSourcePath, validateSynctexEnvelope } from './synctexParser.ts'
import { proofActionIdentity } from './workspaceIdentity.ts'
import type { LatexEngine, LatexProof, LatexSyncQuery } from './types.ts'

const root = new URL('../../../public/mr-resume/latex/busytex-v2/', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8')) as { profileVersion: string; synctex: { path: string; bytes: number; sha256: string } }
const parser = await readFile(new URL(manifest.synctex.path, root))
const bytes = (input: Uint8Array): ArrayBuffer => new Uint8Array(input).buffer
const hash = (input: ArrayBuffer) => createHash('sha256').update(new Uint8Array(input)).digest('hex')
type Fixture = { name: string; engine: LatexEngine; profileVersion: string; pdfBase64: string; synctexBase64: string; pdfSha256: string; synctexSha256: string; sources: { path: string; content: string }[]; geometries: { page: number }[]; expected: { text: string; file: string; line: number; refused?: boolean; query: { page: number; x: number; y: number } }[]; wasm: { sha256: string } }

async function fixture(name = 'multi-file-pdflatex') {
  const data = JSON.parse(await readFile(new URL(`./fixtures/synctex/${name}.json`, import.meta.url), 'utf8')) as Fixture
  assert.equal(data.wasm.sha256, 'a7785b59bfddb8667e7738443f111430e3ee2bd3ec0c1c26629267849e091415', 'Fixtures must come from the real pinned engines')
  const pdf = bytes(Buffer.from(data.pdfBase64, 'base64')), map = bytes(Buffer.from(data.synctexBase64, 'base64'))
  assert.equal(hash(pdf), data.pdfSha256); assert.equal(hash(map), data.synctexSha256)
  const proof: LatexProof = { status: 'ready', runtime: 'browser', projectId: 'synctex-fixture-project', operationKey: 'synctex-fixture-operation', revision: 1, snapshotHash: hash(bytes(Buffer.from(JSON.stringify(data.sources)))), engine: data.engine, profileVersion: manifest.profileVersion,
    pdf: { id: 'synctex-fixture-operation', bytes: pdf.byteLength, sha256: data.pdfSha256, pages: data.geometries.length }, diagnostics: [], log: '', syncAvailable: false, createdAt: '2026-11-05T00:00:00.000Z', data: pdf }
  const artifact: BrowserSyncArtifact = { identity: proofActionIdentity(proof), engine: data.engine, data: map, parser: bytes(parser), parserSha256: manifest.synctex.sha256, sourceFiles: data.sources.map((file) => ({ path: file.path, lines: file.content.split(/\r\n|\r|\n/).length })) }
  const base = { operationKey: proof.operationKey, snapshotHash: proof.snapshotHash, pdfHash: proof.pdf.sha256 }
  return { data, proof, artifact, base }
}

for (const engine of ['pdflatex', 'xelatex', 'lualatex']) for (const kind of ['multi-file', 'columns-macro', 'altacv']) {
  test(`real ${kind} ${engine} corpus uses upstream forward/inverse semantics, exact source lines and honest refusals`, async () => {
    const { data, proof, artifact, base } = await fixture(`${kind}-${engine}`)
    const before = hash(proof.data), originalMap = hash(artifact.data)
    if (engine === 'lualatex') { await assert.rejects(openSynctex(artifact, proof.data), /zero-Y glyph boundaries/); return }
    const parsed = await openSynctex(artifact, proof.data)
    try {
      for (const expected of data.expected) {
        const query: LatexSyncQuery = { ...base, direction: 'inverse', ...expected.query }
        const inverse = parsed.query(query)
        if (expected.refused) { assert.equal(inverse.available, false); assert.deepEqual(inverse.candidates, []) }
        else {
          assert.equal(inverse.available, true, expected.text)
          assert.ok(inverse.candidates.some((candidate) => candidate.file === expected.file && candidate.line === expected.line), `${expected.text}: ${JSON.stringify(inverse)}`)
          for (const candidate of inverse.candidates) for (const location of candidate.locations) {
            assert.equal(location.page, query.page)
            assert.ok(query.x >= location.x - 0.5 && query.x <= location.x + location.width! + 0.5)
            assert.ok(query.y >= location.y - 0.5 && query.y <= location.y + location.height! + 0.5)
          }
        }
        const forward = parsed.query({ ...base, direction: 'forward', file: expected.file, line: expected.line })
        assert.ok(forward.available && forward.candidates.every((candidate) => candidate.file === expected.file && candidate.line === expected.line))
      }
      for (const point of [{ page: 1, x: 1, y: 1 }, { page: 1, x: -1, y: 0 }, { page: 33, x: 50, y: 50 }]) {
        const result = parsed.query({ ...base, direction: 'inverse', ...point }); assert.equal(result.available, false); assert.deepEqual(result.candidates, [])
      }
      assert.equal(parsed.query({ ...base, direction: 'forward', file: '../main.tex', line: 1 }).available, false)
      assert.equal(parsed.query({ ...base, direction: 'forward', file: 'main.tex', line: 199999 }).available, false)
      assert.equal(hash(proof.data), before); assert.equal(hash(artifact.data), originalMap)
    } finally { parsed.close() }
  })
}

test('SyncTeX aliases normalize only compiler roots and literal dot components before exact allowlisting', () => {
  const allowed = new Set(['main.tex', 'sections/body.tex'])
  for (const input of ['main.tex', './main.tex', '/job/./main.tex', '/work/project/./main.tex', '/job/././main.tex']) assert.equal(synctexSourcePath(input, allowed), 'main.tex')
  assert.equal(synctexSourcePath('/job/sections/./body.tex', allowed), 'sections/body.tex')
  for (const input of ['/other/main.tex', '/job/../main.tex', '../main.tex', '/texlive/main.tex', '/job/output.aux', 'Main.tex', 'C:\\main.tex', '/job//main.tex']) assert.equal(synctexSourcePath(input, allowed), null)
})

test('compressed and expanded map bounds, record count, nesting, engine output and malformed data fail before C parsing', async () => {
  const { artifact } = await fixture(), raw = gunzipSync(Buffer.from(artifact.data)).toString('utf8')
  await assert.rejects(expandSynctex(new ArrayBuffer(SYNCTEX_BYTE_LIMIT + 1)), /8 MiB/)
  await assert.rejects(expandSynctex(bytes(gzipSync(Buffer.alloc(SYNCTEX_BYTE_LIMIT + 1, 65)))), /8 MiB/)
  await assert.rejects(expandSynctex(bytes(new Uint8Array([31, 139, 0, 0]))))
  for (const invalid of [raw.replace('Unit:1', 'Unit:0'), raw.replace('Postamble:', 'Invalid:'), raw.replace('SyncTeX Version:1', 'SyncTeX Version:2'), raw.replace('Output:pdf', 'Output:xdv'), raw + 'bad record', raw.replace('Content:', 'Input:1:main.tex\nContent:'), raw.replace('Content:', `Content:\n${'[1,1:1,1:1,1,1\n'.repeat(129)}`), raw + '\n'.repeat(SYNCTEX_RECORD_LIMIT)]) {
    assert.throws(() => validateSynctexEnvelope(new TextEncoder().encode(invalid), 'pdflatex'))
  }
})

test('map queries reject vendor/generated/foreign files and source line overflow rather than remapping them to the main', async () => {
  const { artifact, proof, data, base } = await fixture()
  for (const changed of [
    { ...artifact, data: bytes(gzipSync(Buffer.from(gunzipSync(Buffer.from(artifact.data)).toString('utf8').replace('/job/./main.tex', '/texlive/main.tex')))) },
    { ...artifact, sourceFiles: artifact.sourceFiles.map((file) => ({ ...file, lines: 1 })) },
  ]) {
    const parsed = await openSynctex(changed, proof.data)
    try { assert.equal(parsed.query({ ...base, direction: 'inverse', ...data.expected[0].query }).available, false) }
    finally { parsed.close() }
  }
  await assert.rejects(openSynctex({ ...artifact, parserSha256: 'f'.repeat(64) }, proof.data), /pinned byte check/)
})

test('intrinsic rotation, crop, shifted media origin, nonstandard UserUnit and mismatched page counts are explicit refusals', async () => {
  const { artifact, proof } = await fixture()
  for (const mutation of [
    (pdf: PDFDocument) => pdf.getPage(0).setRotation(degrees(90)),
    (pdf: PDFDocument) => pdf.getPage(0).setCropBox(10, 20, 350, 450),
    (pdf: PDFDocument) => pdf.getPage(0).setMediaBox(10, 20, 400, 500),
    (pdf: PDFDocument) => pdf.getPage(0).node.set(PDFName.of('UserUnit'), PDFNumber.of(2)),
    (pdf: PDFDocument) => pdf.addPage([400, 500]),
  ]) {
    const document = await PDFDocument.load(proof.data); mutation(document)
    await assert.rejects(openSynctex(artifact, bytes(await document.save())), /crop|origin|rotation|page unit|final PDF pages/)
  }
})

function realWorker(): BrowserSyncWorker {
  const native = new NodeWorker(new URL('./browser/synctex-query-worker.mjs', import.meta.url), { execArgv: [] })
  const adapter: BrowserSyncWorker = { onmessage: null, onerror: null, onmessageerror: null, postMessage: (value: unknown, options?: Transferable[] | StructuredSerializeOptions) => {
    const transfer = (Array.isArray(options) ? options : options?.transfer) ?? []
    assert.ok(transfer.every((item) => item instanceof ArrayBuffer)); native.postMessage(value, transfer as ArrayBuffer[])
  }, terminate: () => { void native.terminate() } }
  native.on('message', (data: unknown) => adapter.onmessage?.call(null as unknown as Worker, { data } as MessageEvent<unknown>))
  native.on('error', () => adapter.onerror?.call(null as unknown as Worker, { preventDefault() {} } as ErrorEvent))
  native.on('messageerror', () => adapter.onmessageerror?.call(null as unknown as Worker, {} as MessageEvent))
  return adapter
}

test('exact production module worker transfers copies, stays warm and never detaches canonical proof/map bytes', async () => {
  const { artifact, proof, data, base } = await fixture('multi-file-xelatex'), before = hash(proof.data), map = hash(artifact.data)
  const session = createBrowserSyncSession({ createWorker: realWorker })
  try {
    assert.equal((await session.query(proof, artifact, null)).available, true)
    for (const expected of data.expected) assert.equal((await session.query(proof, artifact, { ...base, direction: 'inverse', ...expected.query })).available, true)
    assert.equal(hash(proof.data), before); assert.equal(hash(artifact.data), map); assert.equal(artifact.parser.byteLength, manifest.synctex.bytes)
  } finally { session.dispose() }
})

class HeldWorker implements BrowserSyncWorker {
  onmessage: BrowserSyncWorker['onmessage'] = null
  onerror: BrowserSyncWorker['onerror'] = null
  onmessageerror: BrowserSyncWorker['onmessageerror'] = null
  terminated = 0
  requests: Record<string, unknown>[] = []
  postMessage(value: unknown) { this.requests.push(value as Record<string, unknown>) }
  terminate() { this.terminated++ }
}

test('worker boundary rejects impossible geometry, unmapped source paths and line/page overflow', async () => {
  const { artifact, proof, base, data } = await fixture(), query: LatexSyncQuery = { ...base, direction: 'inverse', ...data.expected[0].query }
  const location = { page: 1, x: 50, y: 430, width: 100, height: 10 }
  for (const candidate of [
    ...[{ x: -1 }, { y: NaN }, { width: -1 }, { height: 0 }, { page: 2 }, { page: 1.5 }, { x: 20_000 }].map((change) => ({ file: 'main.tex', line: 5, locations: [{ ...location, ...change }] })),
    { file: '../main.tex', line: 5, locations: [location] }, { file: 'vendor.tex', line: 5, locations: [location] }, { file: 'main.tex', line: 9999, locations: [location] }, { file: 'main.tex', line: 5, locations: [] },
  ]) {
    const worker = new HeldWorker(), session = createBrowserSyncSession({ createWorker: () => worker })
    const pending = session.query(proof, artifact, query), rejected = assert.rejects(pending)
    worker.onmessage?.call(null as unknown as Worker, { data: { id: worker.requests[0].id, identity: artifact.identity, ok: true, result: { available: true, candidates: [candidate] } } } as MessageEvent)
    await rejected; assert.equal(worker.terminated, 1); session.dispose()
  }
})

test('abort, superseding queries, disposal and deadlines terminate parser workers; stale results cannot win', async () => {
  const { artifact, proof, base, data } = await fixture(), first = new HeldWorker(), second = new HeldWorker(), workers = [first, second]
  const session = createBrowserSyncSession({ createWorker: () => workers.shift()!, timeoutMs: 1000 })
  const query: LatexSyncQuery = { ...base, direction: 'inverse', ...data.expected[0].query }, controller = new AbortController()
  const old = session.query(proof, artifact, query, controller.signal), oldRejected = assert.rejects(old, { name: 'AbortError' }), stale = first.onmessage
  controller.abort(); await oldRejected; assert.equal(first.terminated, 1)
  const next = session.query(proof, artifact, query), nextRejected = assert.rejects(next, { name: 'AbortError' })
  stale?.call(null as unknown as Worker, { data: { id: first.requests[0].id, identity: artifact.identity, ok: true, result: { available: true, candidates: [] } } } as MessageEvent)
  session.dispose(); await nextRejected; assert.equal(second.terminated, 1)
  const stalled = new HeldWorker(), bounded = createBrowserSyncSession({ createWorker: () => stalled, timeoutMs: 5 })
  await assert.rejects(bounded.query(proof, artifact, query), /bounded worker deadline/)
  assert.equal(stalled.terminated, 1); bounded.dispose()
})

test('runtime-neutral adapter binds the full proof, uses only explicit native sync and never uploads on local failure', async () => {
  const { artifact, proof, base, data } = await fixture(), query: LatexSyncQuery = { ...base, direction: 'inverse', ...data.expected[0].query }
  let nativeCalls = 0, localCalls = 0
  const navigation = createLatexProofNavigation({ createWorker: () => { localCalls++; throw new Error('Local worker unavailable') }, syncNative: async () => { nativeCalls++; return { available: true, file: 'main.tex', line: 5, locations: [] } } })
  for (const changed of [null, { ...artifact, identity: artifact.identity + 'x' }]) assert.equal((await navigation.query(proof, changed, query)).available, false)
  for (const changed of [{ ...proof, profileVersion: 'another-profile' }, { ...proof, engine: 'xelatex' as const }, { ...proof, operationKey: 'different-operation' }]) assert.equal((await navigation.query(changed, artifact, query)).available, false)
  assert.equal((await navigation.query(proof, artifact, { ...query, pdfHash: 'f'.repeat(64) })).available, false)
  assert.equal((await navigation.query(proof, artifact, query)).available, false)
  assert.equal(nativeCalls, 0); assert.equal(localCalls, 1)
  assert.equal((await navigation.query({ ...proof, runtime: 'native', syncAvailable: true }, null, query)).available, true)
  assert.equal(nativeCalls, 1); assert.equal(localCalls, 1)
  assert.equal((await navigation.query({ ...proof, runtime: 'native' }, null, query)).available, false)
  navigation.dispose()
})
