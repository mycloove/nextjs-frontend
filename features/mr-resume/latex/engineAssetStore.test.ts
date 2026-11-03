import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createEngineAssetStore, engineAssetStore, type EngineAssetBackend, type EngineAssetPin, type EngineAssetStoreOptions } from './engineAssetStore.ts'

type StoredAsset = Parameters<EngineAssetBackend['write']>[0]
type Metadata = Awaited<ReturnType<EngineAssetBackend['entries']>>[number]
type Consent = Parameters<EngineAssetBackend['consent']>[1]
const version = 'browser-unit-v1'
const sha = (data: ArrayBuffer) => createHash('sha256').update(new Uint8Array(data)).digest('hex')
const bytes = (value: number, size = 4) => new Uint8Array(size).fill(value).buffer
const pin = (data: ArrayBuffer, path = 'groups/core.tar.gz'): EngineAssetPin => ({ path, bytes: data.byteLength, sha256: sha(data) })
const key = (profile: string, asset: EngineAssetPin) => `${profile}:${asset.sha256.toLowerCase()}`
const quota = () => new DOMException('Unit storage quota exceeded.', 'QuotaExceededError')

class MemoryBackend implements EngineAssetBackend {
  assets = new Map<string, StoredAsset>()
  consents = new Map<string, Consent>()
  projects = new Map([['private-project', 'Private source is outside this backend.']])
  writes = 0
  reads = 0
  removals: string[] = []
  writeError: Error | null = null
  touchError: Error | null = null
  readError: Error | null = null
  beforeWrite?: () => Promise<void>

  async read(id: string, signal?: AbortSignal) { signal?.throwIfAborted(); this.reads++; if (this.readError) throw this.readError; return this.assets.get(id) ?? null }
  async entries(): Promise<Metadata[]> { return [...this.assets.values()].map(({ key, profileVersion, path, bytes, sha256, lastUsed }) => ({ key, profileVersion, path, bytes, sha256, lastUsed })) }
  async write(asset: StoredAsset, evict: (entries: Metadata[]) => string[], signal?: AbortSignal) {
    await this.beforeWrite?.()
    signal?.throwIfAborted()
    const removed = evict(await this.entries())
    if (this.writeError) throw this.writeError
    for (const id of removed) this.assets.delete(id)
    this.assets.set(asset.key, { ...asset })
    this.writes++
  }
  async remove(id: string, signal?: AbortSignal) { signal?.throwIfAborted(); this.removals.push(id); this.assets.delete(id) }
  async touch(id: string, lastUsed: number, signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (this.touchError) throw this.touchError
    const asset = this.assets.get(id)
    if (asset) this.assets.set(id, { ...asset, lastUsed })
  }
  async clear() { this.assets.clear(); this.consents.clear() }
  async hasConsent(id: string) { return this.consents.has(id) }
  async consent(id: string, value: Consent) { this.consents.set(id, { ...value }) }
}

type UnitRequest = { result: unknown; error: DOMException | null; onsuccess: (() => void) | null; onerror: (() => void) | null }
type UnitOperation = { request: UnitRequest; store: string; kind: string; run: () => unknown }
type UnitBucket = { keyPath?: string; values: Map<string, unknown> }

// Only the IndexedDB API used by indexedBackend is simulated. Requests run in
// separate tasks; promise continuations can enqueue requests before auto-commit.
// Transactions serialize, clone values, and publish all scoped stores together.
// This is not a browser conformance, disk durability, or quota implementation.
class UnitIndexedDB {
  buckets = new Map<string, UnitBucket>()
  opened: [string, number | undefined][] = []
  connections: UnitDatabase[] = []
  requests: (UnitRequest & { onblocked: (() => void) | null; onupgradeneeded: (() => void) | null })[] = []
  openModes: ('error' | 'blocked' | 'hang')[] = []
  transactions: UnitTransaction[] = []
  current: UnitTransaction | undefined
  operations: { store: string; kind: string }[] = []
  faults: { store: string; kind: string; error: DOMException }[] = []
  commits = 0
  rollbacks = 0
  beforeCommit?: (tx: UnitTransaction) => void
  afterOperation?: (tx: UnitTransaction, store: string, kind: string) => void
  projects = new Map([['private-project', 'Never part of the engine database.']])

  open(name: string, revision?: number) {
    assert.equal(name, 'mr-resume:latex:engine-assets:v1')
    this.opened.push([name, revision])
    const connection = new UnitDatabase(this)
    this.connections.push(connection)
    const request = { result: connection, error: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null } as typeof this.requests[number]
    this.requests.push(request)
    const mode = this.openModes.shift()
    queueMicrotask(() => {
      if (mode === 'hang') return
      if (mode === 'blocked') { request.onblocked?.(); return }
      if (mode === 'error') { request.error = new DOMException('Unit open failed.', 'UnknownError'); request.onerror?.(); return }
      this.finishOpen(request)
    })
    return request as unknown as IDBOpenDBRequest
  }
  finishOpen(request: typeof this.requests[number]) {
    if (!this.buckets.has('assets') || !this.buckets.has('consents')) request.onupgradeneeded?.()
    request.onsuccess?.()
  }
  bucket(name: string) {
    const bucket = this.buckets.get(name)
    assert.ok(bucket, `Missing unit store ${name}`)
    return bucket.values
  }
  enqueue(tx: UnitTransaction) { this.transactions.push(tx); this.startNext() }
  startNext() {
    if (this.current) return
    this.current = this.transactions.find((tx) => tx.state !== 'terminal')
    if (!this.current) return
    this.current.start()
  }
  finish(tx: UnitTransaction) {
    const index = this.transactions.indexOf(tx)
    assert.ok(index >= 0)
    this.transactions.splice(index, 1)
    if (this.current === tx) this.current = undefined
    this.startNext()
  }
  failNext(store: string, kind: string, error = quota()) { this.faults.push({ store, kind, error }) }
}

class UnitDatabase {
  factory: UnitIndexedDB
  closed = false
  onversionchange: (() => void) | null = null
  onclose: (() => void) | null = null
  constructor(factory: UnitIndexedDB) { this.factory = factory }
  get objectStoreNames() { return { contains: (name: string) => this.factory.buckets.has(name) } }
  createObjectStore(name: string, options?: { keyPath?: string }) {
    this.factory.buckets.set(name, { keyPath: options?.keyPath, values: new Map() })
  }
  close() { this.closed = true }
  versionchange() { this.onversionchange?.() }
  unexpectedClose() { this.closed = true; this.onclose?.() }
  transaction(names: string[], mode: IDBTransactionMode) {
    if (this.closed) throw new DOMException('Unit connection is closed.', 'InvalidStateError')
    assert.ok(names.every((name) => name === 'assets' || name === 'consents'))
    const tx = new UnitTransaction(this.factory, names, mode)
    this.factory.enqueue(tx)
    return tx as unknown as IDBTransaction
  }
}

class UnitTransaction {
  factory: UnitIndexedDB
  names: string[]
  mode: IDBTransactionMode
  views = new Map<string, Map<string, unknown>>()
  queue: UnitOperation[] = []
  state: 'queued' | 'active' | 'terminal' = 'queued'
  scheduled = false
  error: DOMException | null = null
  oncomplete: (() => void) | null = null
  onabort: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(factory: UnitIndexedDB, names: string[], mode: IDBTransactionMode) { this.factory = factory; this.names = names; this.mode = mode }
  start() {
    this.state = 'active'
    for (const name of this.names) this.views.set(name, structuredClone(this.factory.bucket(name)))
    this.schedule()
  }
  objectStore(name: string) {
    if (!this.names.includes(name)) throw new DOMException('Store outside transaction.', 'NotFoundError')
    return new UnitObjectStore(this, name) as unknown as IDBObjectStore
  }
  request(store: string, kind: string, run: () => unknown, reused?: UnitRequest) {
    if (this.state === 'terminal') throw new DOMException('Unit transaction is inactive.', 'TransactionInactiveError')
    const request = reused ?? { result: undefined, error: null, onsuccess: null, onerror: null }
    this.queue.push({ request, store, kind, run }); this.schedule()
    return request
  }
  schedule() {
    if (this.state !== 'active' || this.scheduled) return
    this.scheduled = true
    setImmediate(() => { this.scheduled = false; this.step() })
  }
  step() {
    if (this.state !== 'active') return
    const operation = this.queue.shift()
    if (!operation) {
      this.factory.beforeCommit?.(this)
      if (this.state !== 'active') return
      if (this.mode !== 'readonly') for (const name of this.names) this.factory.buckets.get(name)!.values = this.views.get(name)!
      this.state = 'terminal'; this.factory.commits++; this.oncomplete?.(); this.factory.finish(this)
      return
    }
    this.factory.operations.push({ store: operation.store, kind: operation.kind })
    try {
      const fault = this.factory.faults.findIndex((entry) => entry.store === operation.store && entry.kind === operation.kind)
      if (fault >= 0) throw this.factory.faults.splice(fault, 1)[0].error
      operation.request.result = operation.run()
      this.factory.afterOperation?.(this, operation.store, operation.kind)
      if (this.state === 'active') operation.request.onsuccess?.()
    } catch (error) {
      const failure = error instanceof DOMException ? error : new DOMException(String(error), 'UnknownError')
      operation.request.error = failure; operation.request.onerror?.(); this.onerror?.(); this.abort(failure)
    }
    this.schedule()
  }
  abort(error: DOMException | null = null) {
    if (this.state === 'terminal') throw new DOMException('Unit transaction already terminal.', 'InvalidStateError')
    this.error = error; this.state = 'terminal'
    const abandoned = this.queue.splice(0)
    setImmediate(() => {
      for (const { request } of abandoned) { request.error = new DOMException('Unit request aborted.', 'AbortError'); request.onerror?.() }
      this.factory.rollbacks++; this.onabort?.(); this.factory.finish(this)
    })
  }
}

class UnitObjectStore {
  tx: UnitTransaction
  name: string
  constructor(tx: UnitTransaction, name: string) { this.tx = tx; this.name = name }
  values() { return this.tx.views.get(this.name)! }
  read(kind: string, run: () => unknown) { return this.tx.request(this.name, kind, run) as unknown as IDBRequest }
  write(kind: string, run: () => unknown) {
    if (this.tx.mode === 'readonly') throw new DOMException('Readonly unit transaction.', 'ReadOnlyError')
    return this.read(kind, run)
  }
  get(key: string) { return this.read('get', () => structuredClone(this.values().get(key))) }
  count() { return this.read('count', () => this.values().size) }
  put(value: unknown, suppliedKey?: string) {
    const copy = structuredClone(value), keyPath = this.tx.factory.buckets.get(this.name)!.keyPath
    const key = keyPath ? (copy as Record<string, unknown>)[keyPath] : suppliedKey
    if (typeof key !== 'string') throw new DOMException('Unit key is invalid.', 'DataError')
    return this.write('put', () => { this.values().set(key, copy); return key })
  }
  delete(key: string) { return this.write('delete', () => { this.values().delete(key) }) }
  clear() { return this.write('clear', () => { this.values().clear() }) }
  openCursor() {
    let keys: string[] | undefined, at = 0
    const request: UnitRequest = { result: undefined, error: null, onsuccess: null, onerror: null }
    const advance = () => this.tx.request(this.name, 'cursor', () => {
      keys ??= [...this.values().keys()].sort()
      while (at < keys.length && !this.values().has(keys[at])) at++
      if (at >= keys.length) return null
      const key = keys[at++]
      return { primaryKey: key, value: structuredClone(this.values().get(key)), delete: () => this.delete(key), continue: advance }
    }, request)
    advance()
    return request as unknown as IDBRequest<IDBCursorWithValue | null>
  }
}

function indexedFixture(options: EngineAssetStoreOptions = {}) {
  const factory = new UnitIndexedDB()
  let time = 0
  const store = createEngineAssetStore({ indexedDB: factory as unknown as IDBFactory, now: () => ++time, ...options })
  return { factory, store }
}

function stored(profile: string, data: ArrayBuffer, lastUsed = 0, path = 'groups/core.tar.gz'): StoredAsset {
  const asset = pin(data, path)
  return { ...asset, key: key(profile, asset), profileVersion: profile, lastUsed, data: new Blob([data]) }
}

function fixture(options: EngineAssetStoreOptions = {}) {
  const backend = new MemoryBackend()
  let time = 0
  const store = createEngineAssetStore({ backend, now: () => ++time, ...options })
  return { backend, store }
}

test('the exact public API is lazy and a cold summary does not invent offline readiness', async () => {
  const expected = ['load', 'save', 'summary', 'clear', 'hasConsent', 'consent']
  assert.deepEqual(Object.keys(engineAssetStore).sort(), expected.sort())
  let opens = 0
  const backend = new MemoryBackend(), store = createEngineAssetStore({ open: async () => { opens++; return backend } })
  assert.equal(opens, 0)
  assert.deepEqual(await store.summary(), { available: true, bytes: 0, entries: 0, versions: [] })
  assert.equal(opens, 1)
  const data = bytes(1), asset = pin(data)
  assert.equal(await store.save(version, asset, data), true)
  assert.equal(await store.load(version, pin(bytes(2))), null, 'A stored profile name is not proof that another required pin exists')
  const summary = await store.summary()
  assert.equal(summary.entries, 1); assert.equal(summary.bytes, 4)
  assert.deepEqual(summary.versions, [version])
  assert.equal('ready' in summary, false); assert.equal('offline' in summary, false)
})

test('save and load both hash exact bytes, never detach originals, and isolate versions by SHA key', async () => {
  let hashes = 0
  const { store, backend } = fixture({ hash: async (data) => { hashes++; return sha(data) } })
  const original = bytes(7), asset = pin(original), before = original.slice(0)
  assert.equal(await store.save(version, asset, original), true)
  assert.equal(hashes, 1)
  assert.deepEqual(original, before)
  assert.deepEqual(await store.load(version, asset), before)
  assert.equal(hashes, 2)
  const loaded = await store.load(version, { ...asset, path: 'another/public-alias.wasm' })
  assert.ok(loaded)
  new Uint8Array(loaded)[0] = 99
  assert.deepEqual(await store.load(version, asset), before)
  assert.equal(await store.load('browser-unit-v2', asset), null)
  assert.equal(await store.save('browser-unit-v2', asset, original), true)
  assert.equal(backend.assets.size, 2)
  assert.equal(backend.assets.has(key(version, asset)), true)
})

test('input bytes and pins are captured before asynchronous hashing', async () => {
  let entered!: () => void, release!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  const waiting = new Promise<void>((resolve) => { release = resolve })
  const { store } = fixture({ hash: async (data) => { entered(); await waiting; return sha(data) } })
  const data = bytes(3), original = data.slice(0), asset = pin(data)
  const saving = store.save(version, asset, data)
  await started
  new Uint8Array(data).fill(8); asset.sha256 = 'f'.repeat(64); asset.path = '../private.tex'
  release()
  assert.equal(await saving, true)
  assert.deepEqual(await store.load(version, pin(original)), original)
})

test('same-sized hash corruption is removed rather than returned for execution', async () => {
  const { store, backend } = fixture(), data = bytes(1), asset = pin(data), id = key(version, asset)
  await store.save(version, asset, data)
  backend.assets.set(id, { ...backend.assets.get(id)!, data: new Blob([bytes(2)]) })
  assert.equal(await store.load(version, asset), null)
  assert.deepEqual(backend.removals, [id])
  assert.equal((await store.summary()).entries, 0)
  assert.equal(await store.save(version, asset, data), true)
  assert.deepEqual(await store.load(version, asset), data)
})

test('wrong size, corrupt identity/path and unsupported stored fields are deleted on read', async () => {
  for (const corruption of [
    { data: new Blob([bytes(1, 3)]) }, { bytes: 3 }, { sha256: 'f'.repeat(64) }, { profileVersion: 'other-version' },
    { key: 'wrong-key' }, { path: '../private.tex' }, { lastUsed: NaN }, { project: 'private writing' },
  ]) {
    const { store, backend } = fixture(), data = bytes(1), asset = pin(data), id = key(version, asset)
    await store.save(version, asset, data)
    backend.assets.set(id, { ...backend.assets.get(id)!, ...corruption } as StoredAsset)
    assert.equal(await store.load(version, asset), null, JSON.stringify(corruption))
    assert.equal(backend.assets.has(id), false)
  }
})

test('invalid writes do not enter storage or remove an existing valid cached asset', async () => {
  const { store, backend } = fixture(), data = bytes(1), asset = pin(data)
  assert.equal(await store.save(version, asset, bytes(1, 3)), false)
  assert.equal(await store.save(version, asset, bytes(2)), false)
  assert.equal(await store.save(version, asset, new Blob([data]) as unknown as ArrayBuffer), false)
  assert.equal(backend.writes, 0)
  await store.save(version, asset, data)
  assert.equal(await store.save(version, asset, bytes(3)), false)
  assert.deepEqual(await store.load(version, asset), data)
  assert.equal(backend.writes, 1)
})

test('unsafe identifiers, paths, hashes and non-finite/integer sizes refuse without opening storage', async () => {
  let opens = 0, hashes = 0
  const store = createEngineAssetStore({ open: async () => { opens++; return new MemoryBackend() }, hash: async (data) => { hashes++; return sha(data) } })
  const data = bytes(1), asset = pin(data)
  for (const profile of ['', '../v1', 'v1?source=private', 'v1:alias', 'v1\\name', 'v1\n', 'v'.repeat(257), null]) {
    assert.equal(await store.save(profile as string, asset, data), false)
    assert.equal(await store.load(profile as string, asset), null)
  }
  for (const path of ['', '../asset.wasm', 'groups/../asset.wasm', './asset.wasm', '/asset.wasm', '//host/asset.wasm', 'https://host/asset.wasm',
    'C:/asset.wasm', 'groups\\asset.wasm', 'asset.wasm?private=source', 'asset.wasm#fragment', 'groups//asset.wasm', '.hidden.wasm',
    'groups/asset.', 'groups/%2e%2e/asset.wasm', 'asset wasm', 'asset\n.wasm', 'a'.repeat(513)]) {
    assert.equal(await store.save(version, { ...asset, path }, data), false, path)
    assert.equal(await store.load(version, { ...asset, path }), null, path)
  }
  for (const invalid of [null, [], { ...asset, source: 'private' }, { ...asset, sha256: 'z'.repeat(64) }, { ...asset, sha256: 'a'.repeat(63) },
    ...[0, -1, NaN, Infinity, 4.5, 128 * 1024 * 1024 + 1, Number.MAX_SAFE_INTEGER + 1].map((size) => ({ ...asset, bytes: size }))]) {
    assert.equal(await store.save(version, invalid as EngineAssetPin, data), false)
    assert.equal(await store.load(version, invalid as EngineAssetPin), null)
  }
  assert.equal(opens, 0); assert.equal(hashes, 0)
})

test('hexadecimal pins normalize case without creating duplicate assets or changing consent identity', async () => {
  const { store, backend } = fixture(), data = bytes(1), asset = pin(data), uppercase = { ...asset, sha256: asset.sha256.toUpperCase() }
  assert.equal(await store.save(version, uppercase, data), true)
  assert.deepEqual(await store.load(version, asset), data)
  assert.equal(await store.save(version, asset, data), true)
  assert.equal(backend.assets.size, 1)
  await store.consent(version, 'layout', uppercase.sha256)
  assert.equal(await store.hasConsent(version, 'layout', asset.sha256), true)
})

test('IndexedDB unavailable degrades to misses/false with no buffer-retaining memory fallback', async () => {
  const store = createEngineAssetStore({ indexedDB: null }), data = bytes(1), asset = pin(data)
  assert.equal(await store.save(version, asset, data), false)
  assert.equal(await store.load(version, asset), null)
  assert.equal(await store.save(version, asset, data), false)
  await store.consent(version, 'layout', asset.sha256)
  assert.equal(await store.hasConsent(version, 'layout', asset.sha256), false)
  await assert.rejects(store.clear(), { name: 'EngineCacheClearError' })
  const summary = await store.summary()
  assert.equal(summary.available, false); assert.equal(summary.bytes, 0); assert.equal(summary.entries, 0)
  assert.deepEqual(summary.versions, [])
  assert.match(summary.reason!, /unavailable.*Network assets remain usable/u)
  assert.deepEqual(data, bytes(1), 'The caller can still execute its fresh network bytes')
})

test('quota failure is atomic across planned evictions and preserves fresh network bytes', async () => {
  const { store, backend } = fixture({ maxBytes: 8, maxAssetBytes: 4 })
  for (const value of [1, 2]) assert.equal(await store.save(version, pin(bytes(value)), bytes(value)), true)
  backend.writeError = quota()
  const data = bytes(3), asset = pin(data)
  assert.equal(await store.save('browser-unit-v2', asset, data), false)
  assert.equal(backend.assets.size, 2)
  const summary = await store.summary()
  assert.equal(summary.available, false); assert.equal(summary.bytes, 8); assert.equal(summary.entries, 2)
  assert.deepEqual(summary.versions, [version]); assert.match(summary.reason!, /quota/u)
  assert.deepEqual(data, bytes(3))
  backend.writeError = null
  assert.equal(await store.save('browser-unit-v2', asset, data), true)
  assert.equal((await store.summary()).available, true)
})

test('a quota failure while touching LRU metadata does not discard verified cached execution bytes', async () => {
  const { store, backend } = fixture(), data = bytes(4), asset = pin(data)
  await store.save(version, asset, data)
  backend.touchError = quota()
  assert.deepEqual(await store.load(version, asset), data)
  assert.equal((await store.summary()).available, false)
  backend.touchError = null
  assert.deepEqual(await store.load(version, asset), data)
  assert.equal((await store.summary()).available, true)
})

test('backend and hash failures are graceful misses, not an alternate source of unverified assets', async () => {
  const { store, backend } = fixture(), data = bytes(4), asset = pin(data)
  await store.save(version, asset, data)
  backend.readError = new Error('Unit backend unavailable.')
  assert.equal(await store.load(version, asset), null)
  assert.equal((await store.summary()).available, false)
  const noHash = createEngineAssetStore({ backend, hash: async () => { throw new Error('No digest available.') } })
  assert.equal(await noHash.save(version, asset, data), false)
  backend.readError = null
  assert.equal(await noHash.load(version, asset), null)
  assert.equal(backend.assets.size, 1, 'Unavailable verification is not proof that stored bytes are corrupt')
})

test('LRU eviction within versions keeps recently loaded assets', async () => {
  const { store, backend } = fixture({ maxBytes: 12, maxAssetBytes: 4 }), v2 = 'browser-unit-v2'
  for (const value of [1, 2]) await store.save(version, pin(bytes(value)), bytes(value))
  await store.save(v2, pin(bytes(3)), bytes(3))
  await store.load(version, pin(bytes(1)))
  await store.save(v2, pin(bytes(4)), bytes(4))
  assert.equal(backend.assets.has(key(version, pin(bytes(2)))), false)
  for (const [profile, value] of [[version, 1], [v2, 3], [v2, 4]] as const) assert.deepEqual(await store.load(profile, pin(bytes(value))), bytes(value))
  assert.equal((await store.summary()).bytes, 12)
})

test('pressure prefers a complete newest working set over a previous-version single-asset anchor', async () => {
  const { store, backend } = fixture({ maxBytes: 12, maxAssetBytes: 4 }), v2 = 'browser-unit-v2'
  await store.save(version, pin(bytes(1)), bytes(1))
  for (const value of [2, 3, 4]) await store.save(v2, pin(bytes(value)), bytes(value))
  assert.equal(backend.assets.has(key(version, pin(bytes(1)))), false, 'Both complete sets cannot fit the 12-byte budget')
  for (const value of [2, 3, 4]) assert.equal(backend.assets.has(key(v2, pin(bytes(value)))), true)
  assert.deepEqual((await store.summary()).versions, [v2])
  assert.equal((await store.summary()).bytes, 12)
})

test('older versions are retained while budget permits and evicted before the latest two under pressure', async () => {
  const { store, backend } = fixture({ maxBytes: 16, maxAssetBytes: 4 }), v2 = 'browser-unit-v2', v3 = 'browser-unit-v3'
  for (const [profile, value] of [[version, 1], [v2, 2], [v3, 3], [v3, 4]] as const) await store.save(profile, pin(bytes(value)), bytes(value))
  assert.deepEqual((await store.summary()).versions, [v3, v2, version])
  await store.save(v3, pin(bytes(5)), bytes(5))
  assert.equal(backend.assets.has(key(version, pin(bytes(1)))), false)
  assert.equal(backend.assets.has(key(v2, pin(bytes(2)))), true)
  assert.deepEqual((await store.summary()).versions, [v3, v2])
  const small = fixture({ maxBytes: 6, maxAssetBytes: 4 }).store
  await small.save(version, pin(bytes(1)), bytes(1)); await small.save(v2, pin(bytes(2)), bytes(2))
  assert.deepEqual((await small.summary()).versions, [v2], 'Two 4-byte assets cannot both fit in a 6-byte budget')
})

test('single-asset and total budgets cannot be raised above the hard limits', async () => {
  const { store, backend } = fixture({ maxBytes: 1024 * 1024 * 1024, maxAssetBytes: 1024 * 1024 * 1024 })
  const data = bytes(1)
  assert.equal(await store.save(version, { ...pin(data), bytes: 128 * 1024 * 1024 + 1 }, data), false)
  assert.equal(backend.writes, 0)
  const bounded = fixture({ maxBytes: 3, maxAssetBytes: 4 }).store
  assert.equal(await bounded.save(version, pin(data), data), false)
  for (const maxBytes of [NaN, Infinity, -1, 0, 2.5]) {
    const invalid = createEngineAssetStore({ backend: new MemoryBackend(), maxBytes })
    assert.equal(await invalid.save(version, pin(bytes(1, 1)), bytes(1, 1)), false)
    assert.equal((await invalid.summary()).available, false)
  }
})

test('tiny assets have a separate record bound, with LRU eviction rather than unbounded metadata retention', async () => {
  const { store, backend } = fixture()
  for (let index = 0; index < 1024; index++) {
    const data = new Uint8Array([index & 255, index >>> 8]).buffer, asset = pin(data)
    backend.assets.set(key(version, asset), { ...asset, key: key(version, asset), profileVersion: version, lastUsed: 0, data: new Blob([data]) })
  }
  const data = bytes(8), asset = pin(data)
  assert.equal(await store.save('browser-unit-v2', asset, data), true)
  assert.equal(backend.assets.size, 1024)
  assert.equal(backend.assets.has(key('browser-unit-v2', asset)), true)
  assert.deepEqual((await store.summary()).versions, ['browser-unit-v2', version])
})

test('consent is bound to exact public version/group/hash and clear never touches project data', async () => {
  const { store, backend } = fixture(), data = bytes(1), asset = pin(data), projects = new Map(backend.projects)
  assert.equal(await store.hasConsent(version, 'layout', asset.sha256), false)
  await store.consent(version, 'layout', asset.sha256)
  assert.equal(await store.hasConsent(version, 'layout', asset.sha256), true)
  assert.equal(await store.hasConsent('browser-unit-v2', 'layout', asset.sha256), false)
  assert.equal(await store.hasConsent(version, 'other-group', asset.sha256), false)
  assert.equal(await store.hasConsent(version, 'layout', pin(bytes(2)).sha256), false)
  assert.deepEqual([...backend.consents.values()], [{ profileVersion: version, groupID: 'layout', groupHash: asset.sha256, lastUsed: 2 }])
  for (const [profile, group, hash] of [['', 'layout', asset.sha256], [version, 'private source\n', asset.sha256], [version, '../group', asset.sha256], [version, 'layout', 'not-pinned']] as const) {
    await store.consent(profile, group, hash)
    assert.equal(await store.hasConsent(profile, group, hash), false)
  }
  assert.equal(backend.consents.size, 1)
  await store.save(version, asset, data); await store.save('browser-unit-v2', asset, data)
  await store.clear()
  assert.deepEqual(await store.summary(), { available: true, bytes: 0, entries: 0, versions: [] })
  assert.equal(await store.hasConsent(version, 'layout', asset.sha256), false)
  assert.deepEqual(backend.projects, projects)
})

test('pre-aborted signals reject with their true reason and never poison later cache calls', async () => {
  const { store, backend } = fixture(), data = bytes(1), asset = pin(data), controller = new AbortController()
  const cancelled = new Error('Actual caller cancellation.')
  controller.abort(cancelled)
  await assert.rejects(store.save(version, asset, data, controller.signal), (error: unknown) => error === cancelled)
  await assert.rejects(store.load(version, asset, controller.signal), (error: unknown) => error === cancelled)
  assert.equal(backend.reads, 0); assert.equal(backend.writes, 0)
  assert.equal(await store.save(version, asset, data), true)
  assert.equal((await store.summary()).available, true)
})

test('cancellation during hashing is prompt, leaves no write, and remains distinct from cache unavailability', async () => {
  let entered!: () => void, release!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve }), waiting = new Promise<void>((resolve) => { release = resolve })
  let first = true
  const { store, backend } = fixture({ hash: async (data) => { if (first) { first = false; entered(); await waiting }; return sha(data) } })
  const controller = new AbortController(), data = bytes(1), asset = pin(data)
  const saving = store.save(version, asset, data, controller.signal)
  const failure = assert.rejects(saving, { name: 'AbortError' })
  await started; controller.abort(); await failure
  assert.equal(backend.writes, 0)
  release()
  assert.equal(await store.save(version, asset, data), true)
  assert.equal((await store.summary()).available, true)
})

test('one caller aborting a shared open does not cancel another caller or retain a failed-open state', async () => {
  const backend = new MemoryBackend(), data = bytes(1), asset = pin(data)
  await createEngineAssetStore({ backend }).save(version, asset, data)
  let opened!: () => void, release!: (backend: EngineAssetBackend) => void, opens = 0
  const entered = new Promise<void>((resolve) => { opened = resolve }), pending = new Promise<EngineAssetBackend>((resolve) => { release = resolve })
  const store = createEngineAssetStore({ open: () => { opens++; opened(); return pending } }), controller = new AbortController()
  const aborted = store.load(version, asset, controller.signal), failure = assert.rejects(aborted, { name: 'AbortError' })
  const other = store.load(version, asset)
  await entered; controller.abort(); await failure
  release(backend)
  assert.deepEqual(await other, data)
  assert.equal(opens, 1)
  assert.equal((await store.summary()).available, true)
})

test('an aborted write transaction cannot commit late or disable the store for later calls', async () => {
  const { store, backend } = fixture(), data = bytes(1), asset = pin(data)
  let entered!: () => void, release!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve }), waiting = new Promise<void>((resolve) => { release = resolve })
  backend.beforeWrite = async () => { entered(); await waiting }
  const controller = new AbortController(), saving = store.save(version, asset, data, controller.signal), failure = assert.rejects(saving, { name: 'AbortError' })
  await started; controller.abort(); await failure; release()
  backend.beforeWrite = undefined
  assert.equal(await store.save(version, asset, data), true)
  assert.equal(backend.writes, 1)
  assert.equal((await store.summary()).available, true)
})

test('true backend cancellation is not swallowed as a cache miss even without a supplied signal', async () => {
  const { store, backend } = fixture(), data = bytes(1), asset = pin(data)
  backend.readError = new DOMException('Actual backend cancellation.', 'AbortError')
  await assert.rejects(store.load(version, asset), { name: 'AbortError' })
  backend.readError = null
  assert.equal((await store.summary()).available, true)
})

test('clear invalidates already-started hashing so a late save cannot resurrect cleared assets', async () => {
  let entered!: () => void, release!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve }), waiting = new Promise<void>((resolve) => { release = resolve })
  const { store, backend } = fixture({ hash: async (data) => { entered(); await waiting; return sha(data) } })
  const saving = store.save(version, pin(bytes(1)), bytes(1))
  await started; await store.clear(); release()
  assert.equal(await saving, false)
  assert.equal(backend.writes, 0)
  assert.equal((await store.summary()).entries, 0)
})

test('the real IndexedDB open uses an independent database and closes late blocked-open handles', async () => {
  const opened: [string, number | undefined][] = [], created: string[] = []
  let closes = 0, request!: IDBOpenDBRequest
  const database = { objectStoreNames: { contains: () => false }, createObjectStore: (name: string) => { created.push(name) }, close: () => { closes++ } } as unknown as IDBDatabase
  const factory = { open: (name: string, revision?: number) => {
    opened.push([name, revision])
    request = { result: database } as IDBOpenDBRequest
    queueMicrotask(() => {
      request.onupgradeneeded?.call(request, {} as IDBVersionChangeEvent)
      request.onblocked?.call(request, {} as IDBVersionChangeEvent)
    })
    return request
  } } as IDBFactory
  const store = createEngineAssetStore({ indexedDB: factory })
  assert.equal(opened.length, 0)
  const summary = await store.summary()
  assert.equal(summary.available, false); assert.match(summary.reason!, /Another tab blocks/u)
  assert.deepEqual(opened, [['mr-resume:latex:engine-assets:v1', 1]])
  assert.notEqual(opened[0][0], 'mr-resume:latex:v1')
  assert.deepEqual(created, ['assets', 'consents'])
  request.onsuccess?.call(request, {} as Event)
  assert.equal(closes, 1)
})

test('IndexedDB adapter waits for commit and independently verifies ordinary source-pinned manifest bytes', async () => {
  let hashes = 0, resolved = false
  const factory = new UnitIndexedDB(), store = createEngineAssetStore({ indexedDB: factory as unknown as IDBFactory, hash: async (data) => {
    assert.equal(factory.current, undefined, 'Hashing must happen outside a transaction')
    hashes++; return sha(data)
  } })
  factory.beforeCommit = (tx) => { if (tx.mode === 'readwrite') assert.equal(resolved, false, 'save must await transaction completion') }
  const data = new TextEncoder().encode('{"version":1}\n').buffer, asset = pin(data, 'manifest.json'), original = data.slice(0)
  assert.equal(await store.save(version, asset, data).then((saved) => { resolved = true; return saved }), true)
  factory.beforeCommit = undefined
  new Uint8Array(data).fill(0)
  assert.deepEqual(await store.load(version, asset), original)
  assert.equal(hashes, 2)
  assert.equal(factory.bucket('assets').size, 1)
  assert.deepEqual(await store.summary(), { available: true, bytes: original.byteLength, entries: 1, versions: [version] })
  assert.deepEqual(factory.opened, [['mr-resume:latex:engine-assets:v1', 1]])
})

test('IndexedDB quota abort rolls back actual planned deletions, flags and the incoming write', async () => {
  const { store, factory } = indexedFixture({ maxBytes: 8, maxAssetBytes: 4 })
  for (const value of [1, 2]) await store.save(version, pin(bytes(value)), bytes(value))
  const before = structuredClone(factory.bucket('assets')), start = factory.operations.length
  factory.failNext('assets', 'put')
  const data = bytes(3), asset = pin(data), v2 = 'browser-unit-v2'
  assert.equal(await store.save(v2, asset, data), false)
  assert.deepEqual(factory.bucket('assets'), before)
  assert.equal(factory.rollbacks, 1)
  const changes = factory.operations.slice(start).filter((operation) => operation.kind === 'put' || operation.kind === 'delete')
  assert.deepEqual(changes.map((operation) => operation.kind), ['delete', 'put'])
  assert.equal((await store.summary()).available, false)
  assert.deepEqual(data, bytes(3))
  assert.equal(await store.save(v2, asset, data), true)
  assert.equal((await store.summary()).available, true)
})

test('IndexedDB cursor cleanup preserves the originating storage error instead of a queued request AbortError', async () => {
  const { store, factory } = indexedFixture()
  await store.save(version, pin(bytes(1)), bytes(1))
  factory.bucket('assets').set('000-corrupt', { project: 'Not an engine record.' })
  const before = structuredClone(factory.bucket('assets'))
  factory.failNext('assets', 'delete')
  const summary = await store.summary()
  assert.equal(summary.available, false); assert.match(summary.reason!, /quota/u)
  assert.deepEqual(factory.bucket('assets'), before); assert.equal(factory.rollbacks, 1)
  assert.equal((await store.summary()).entries, 1)
  assert.equal(factory.bucket('assets').has('000-corrupt'), false)
  assert.deepEqual(await store.load(version, pin(bytes(1))), bytes(1))
  assert.equal((await store.summary()).available, true)
})

test('IndexedDB overflow recovery uses a bounded count/reset confined to engine assets', async () => {
  const { store, factory } = indexedFixture()
  await store.summary()
  await store.consent(version, 'layout', pin(bytes(1)).sha256)
  const consents = structuredClone(factory.bucket('consents')), projects = structuredClone(factory.projects)
  for (let index = 0; index < 1025; index++) factory.bucket('assets').set(`corrupt-${index}`, { private: 'Not an engine record.' })
  const start = factory.operations.length
  assert.deepEqual(await store.summary(), { available: true, bytes: 0, entries: 0, versions: [] })
  assert.deepEqual(factory.operations.slice(start), [{ store: 'assets', kind: 'count' }, { store: 'assets', kind: 'clear' }])
  assert.deepEqual(factory.bucket('consents'), consents); assert.deepEqual(factory.projects, projects)
  for (let index = 0; index < 1025; index++) factory.bucket('assets').set(`corrupt-${index}`, {})
  assert.equal(await store.save(version, pin(bytes(2)), bytes(2)), true)
  assert.equal(factory.bucket('assets').size, 1)
  assert.deepEqual(await store.load(version, pin(bytes(2))), bytes(2))
  assert.deepEqual(factory.bucket('consents'), consents)
})

test('IndexedDB scans remove malformed records without decoding Blobs and reset over-budget data', async () => {
  let hashes = 0
  const { store, factory } = indexedFixture({ hash: async (data) => { hashes++; return sha(data) } })
  await store.summary()
  const valid = stored(version, bytes(1))
  factory.bucket('assets').set(valid.key, valid)
  factory.bucket('assets').set('malformed', { ...stored(version, bytes(2)), project: 'private' })
  factory.bucket('assets').set('oversized', { ...stored(version, bytes(3)), bytes: 128 * 1024 * 1024 + 1 })
  assert.equal((await store.summary()).entries, 1)
  assert.equal(factory.bucket('assets').size, 1); assert.equal(hashes, 0)
  factory.bucket('assets').clear()
  // Immutable Blob parts share their payload; no 128 MiB ArrayBuffer is read or hashed.
  const part = new Blob([bytes(0, 1024 * 1024)]), large = new Blob(Array<Blob>(128).fill(part))
  for (const digit of ['a', 'b', 'c']) {
    const sha256 = digit.repeat(64), id = `${version}:${sha256}`
    factory.bucket('assets').set(id, { ...valid, key: id, sha256, bytes: large.size, data: large })
  }
  assert.equal((await store.summary()).entries, 0)
  assert.equal(factory.bucket('assets').size, 0); assert.equal(hashes, 0)
})

test('IndexedDB hash corruption is discarded and the surviving version records observed incompleteness', async () => {
  const { store, factory } = indexedFixture()
  for (const value of [1, 2]) await store.save(version, pin(bytes(value)), bytes(value))
  const id = key(version, pin(bytes(1))), asset = factory.bucket('assets').get(id) as StoredAsset
  factory.bucket('assets').set(id, { ...asset, data: new Blob([bytes(9)]) })
  assert.equal(await store.load(version, pin(bytes(1))), null)
  assert.equal(factory.bucket('assets').has(id), false)
  assert.deepEqual((await store.summary()).incompleteVersions, [version])
  assert.deepEqual(await store.load(version, pin(bytes(2))), bytes(2))
})

test('IndexedDB scan cleanup reports canonical-version sibling removals immediately and persistently', async () => {
  let hashes = 0
  const { store, factory } = indexedFixture({ hash: async (data) => { hashes++; return sha(data) } }), v2 = 'browser-unit-v2'
  for (const value of [1, 2]) await store.save(version, pin(bytes(value)), bytes(value))
  await store.save(v2, pin(bytes(3)), bytes(3))
  const id = key(version, pin(bytes(1))), asset = factory.bucket('assets').get(id) as StoredAsset
  factory.bucket('assets').set(id, { ...asset, path: '../bad' })
  factory.bucket('assets').set('arbitrary-corrupt', { ...stored(v2, bytes(4)), path: '../bad', incomplete: true })
  const summary = await store.summary()
  assert.deepEqual(summary, { available: true, bytes: 8, entries: 2, versions: [v2, version], incompleteVersions: [version] })
  assert.equal(factory.bucket('assets').has(id), false)
  assert.equal((factory.bucket('assets').get(key(version, pin(bytes(2)))) as StoredAsset).incomplete, true)
  assert.equal((factory.bucket('assets').get(key(v2, pin(bytes(3)))) as StoredAsset).incomplete, undefined, 'Arbitrary metadata must not taint another version')
  assert.deepEqual(await store.summary(), summary)
  assert.equal(hashes, 3, 'Scan cleanup must not hash or decode asset bytes')
})

test('IndexedDB scan cleanup preserves removal history when its flagged anchor becomes malformed', async () => {
  const { store, factory } = indexedFixture({ maxBytes: 16, maxAssetBytes: 4 }), v2 = 'browser-unit-v2'
  for (const value of [1, 2, 3]) await store.save(version, pin(bytes(value)), bytes(value))
  for (const value of [4, 5]) await store.save(v2, pin(bytes(value)), bytes(value))
  const id = key(version, pin(bytes(3))), sibling = key(version, pin(bytes(2))), anchor = factory.bucket('assets').get(id) as StoredAsset
  assert.equal(anchor.incomplete, true)
  assert.equal((factory.bucket('assets').get(sibling) as StoredAsset).incomplete, undefined)
  factory.bucket('assets').set(id, { ...anchor, path: '../bad' })
  const summary = await store.summary()
  assert.deepEqual(summary, { available: true, bytes: 12, entries: 3, versions: [v2, version], incompleteVersions: [version] })
  assert.equal(factory.bucket('assets').has(id), false)
  assert.equal((factory.bucket('assets').get(sibling) as StoredAsset).incomplete, true)
  assert.deepEqual(await store.summary(), summary)
})

test('IndexedDB preserves both entire recent working sets when combined caps permit', async () => {
  const { store, factory } = indexedFixture({ maxBytes: 16, maxAssetBytes: 4 }), v2 = 'browser-unit-v2', v3 = 'browser-unit-v3'
  for (const [profile, value] of [[version, 1], [version, 2], [v2, 3], [v2, 4], [v3, 5], [v3, 6]] as const) {
    assert.equal(await store.save(profile, pin(bytes(value)), bytes(value)), true)
  }
  assert.equal(factory.bucket('assets').size, 4)
  for (const [profile, value] of [[v2, 3], [v2, 4], [v3, 5], [v3, 6]] as const) assert.deepEqual(await store.load(profile, pin(bytes(value))), bytes(value))
  const summary = await store.summary()
  assert.deepEqual(summary.versions, [v3, v2]); assert.equal(summary.bytes, 16)
  assert.equal('incompleteVersions' in summary, false)
})

test('IndexedDB normal 1024-record pressure has deterministic eviction and preserves both recent sets', async () => {
  const { store, factory } = indexedFixture(), v2 = 'browser-unit-v2', v3 = 'browser-unit-v3'
  await store.summary()
  const olderKeys: string[] = []
  for (let index = 0; index < 1022; index++) {
    const asset = stored(version, new Uint8Array([index & 255, index >>> 8]).buffer)
    factory.bucket('assets').set(asset.key, asset); olderKeys.push(asset.key)
  }
  for (const [value, lastUsed] of [[7, 1], [8, 2]] as const) {
    const asset = stored(v2, bytes(value), lastUsed)
    factory.bucket('assets').set(asset.key, asset)
  }
  for (const value of [9, 10]) assert.equal(await store.save(v3, pin(bytes(value)), bytes(value)), true)
  assert.equal(factory.bucket('assets').size, 1024)
  const removed = olderKeys.filter((id) => !factory.bucket('assets').has(id)).sort()
  assert.deepEqual(removed, olderKeys.sort().slice(0, 2), 'Equal-age records use a stable key tie-break')
  for (const [profile, value] of [[v2, 7], [v2, 8], [v3, 9], [v3, 10]] as const) assert.deepEqual(await store.load(profile, pin(bytes(value))), bytes(value))
  assert.deepEqual((await store.summary()).incompleteVersions, [version])
})

test('IndexedDB pressure warnings survive reopen and do not claim complete/offline-ready sets', async () => {
  const { store, factory } = indexedFixture({ maxBytes: 12, maxAssetBytes: 4 }), v2 = 'browser-unit-v2'
  for (const value of [1, 2]) await store.save(version, pin(bytes(value)), bytes(value))
  for (const value of [3, 4]) await store.save(v2, pin(bytes(value)), bytes(value))
  assert.equal(factory.bucket('assets').size, 3)
  assert.deepEqual(await store.load(v2, pin(bytes(3))), bytes(3))
  assert.deepEqual(await store.load(v2, pin(bytes(4))), bytes(4))
  const reopened = createEngineAssetStore({ indexedDB: factory as unknown as IDBFactory, maxBytes: 12, maxAssetBytes: 4 })
  const summary = await reopened.summary()
  assert.deepEqual(summary.incompleteVersions, [version]); assert.equal(summary.available, true)
  assert.equal('ready' in summary, false); assert.equal('offline' in summary, false)
  await reopened.clear()
  assert.equal('incompleteVersions' in await reopened.summary(), false)
})

test('IndexedDB consent capacity evicts obsolete versions before LRU approvals in recent versions', async () => {
  const { store, factory } = indexedFixture(), v2 = 'browser-unit-v2', v3 = 'browser-unit-v3', hash = pin(bytes(1)).sha256
  await store.summary()
  await store.save(version, pin(bytes(2)), bytes(2))
  const assets = structuredClone(factory.bucket('assets'))
  for (let index = 0; index < 510; index++) {
    const groupID = `group${String(index).padStart(3, '0')}`
    factory.bucket('consents').set(`${version}:${groupID}:${hash}`, { profileVersion: version, groupID, groupHash: hash, lastUsed: 100 + index })
  }
  for (const [groupID, lastUsed] of [['old', 0], ['anchor', 1000]] as const) factory.bucket('consents').set(`${v2}:${groupID}:${hash}`, { profileVersion: v2, groupID, groupHash: hash, lastUsed })
  await store.consent(v3, 'new', hash)
  assert.equal(factory.bucket('consents').size, 512)
  assert.equal(factory.bucket('consents').has(`${version}:group000:${hash}`), false)
  assert.equal(factory.bucket('consents').has(`${v2}:old:${hash}`), true)
  assert.equal(await store.hasConsent(v3, 'new', hash), true)
  assert.deepEqual(factory.bucket('assets'), assets)
})

test('IndexedDB consent LRU is deterministic at 512 records and replaces superseded group hashes', async () => {
  const { store, factory } = indexedFixture(), hash = pin(bytes(1)).sha256
  await store.summary()
  for (let index = 511; index >= 0; index--) {
    const groupID = `group${String(index).padStart(3, '0')}`
    factory.bucket('consents').set(`${version}:${groupID}:${hash}`, { profileVersion: version, groupID, groupHash: hash, lastUsed: 0 })
  }
  assert.equal(await store.hasConsent(version, 'group000', hash), true)
  await store.consent(version, 'new', hash)
  assert.equal(factory.bucket('consents').has(`${version}:group000:${hash}`), true)
  assert.equal(factory.bucket('consents').has(`${version}:group001:${hash}`), false)
  assert.equal(factory.bucket('consents').size, 512)
  const replacement = pin(bytes(2)).sha256
  await store.consent(version, 'group010', replacement)
  assert.equal(factory.bucket('consents').has(`${version}:group010:${hash}`), false)
  assert.equal(await store.hasConsent(version, 'group010', replacement), true)
  assert.equal(factory.bucket('consents').size, 512)
})

test('IndexedDB consent overflow/corruption recovery never resets engine assets', async () => {
  const { store, factory } = indexedFixture(), hash = pin(bytes(1)).sha256
  await store.save(version, pin(bytes(2)), bytes(2))
  const assets = structuredClone(factory.bucket('assets'))
  for (let index = 0; index < 513; index++) factory.bucket('consents').set(`corrupt-${index}`, { project: 'Not consent.' })
  const start = factory.operations.length
  await store.consent(version, 'new', hash)
  assert.deepEqual(factory.operations.slice(start), [
    { store: 'consents', kind: 'count' }, { store: 'consents', kind: 'clear' }, { store: 'consents', kind: 'put' },
  ])
  factory.bucket('consents').set('corrupt', { profileVersion: version, groupID: 'new', groupHash: hash, extra: true })
  await store.consent(version, 'other', hash)
  assert.equal(factory.bucket('consents').has('corrupt'), false)
  assert.equal(await store.hasConsent(version, 'new', hash), true)
  assert.deepEqual(factory.bucket('assets'), assets)
})

test('IndexedDB blocked/error opens are shared, bounded and retryable on subsequent calls', async () => {
  for (const mode of ['blocked', 'error'] as const) {
    const { store, factory } = indexedFixture()
    factory.openModes.push(mode)
    const data = bytes(1), asset = pin(data)
    const [summary, loaded] = await Promise.all([store.summary(), store.load(version, asset)])
    assert.equal(summary.available, false); assert.equal(loaded, null)
    assert.equal(factory.opened.length, 1, 'No automatic retry loop or duplicate concurrent opens')
    assert.equal((await store.summary()).available, true)
    assert.equal(factory.opened.length, 2)
    factory.finishOpen(factory.requests[0])
    assert.equal(factory.connections[0].closed, true, 'A late failed-open connection must close')
    assert.equal(await store.save(version, asset, data), true)
    assert.equal(factory.opened.length, 2)
  }
})

test('IndexedDB opening timeout is bounded and its late handle cannot poison a successful reopen', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { store, factory } = indexedFixture()
  factory.openModes.push('hang')
  let settled = false
  const pending = store.summary().then((summary) => { settled = true; return summary })
  await Promise.resolve()
  assert.equal(factory.opened.length, 1)
  t.mock.timers.tick(9999); assert.equal(settled, false)
  t.mock.timers.tick(1)
  const failed = await pending
  assert.equal(failed.available, false); assert.match(failed.reason!, /did not open in time/u)
  assert.equal((await store.summary()).available, true)
  factory.finishOpen(factory.requests[0])
  assert.equal(factory.connections[0].closed, true)
  assert.equal((await store.summary()).available, true); assert.equal(factory.opened.length, 2)
})

test('IndexedDB versionchange, unexpected close and silent closed handles reset only their own connection', async () => {
  const { store, factory } = indexedFixture(), data = bytes(1), asset = pin(data)
  await store.save(version, asset, data); await store.consent(version, 'layout', asset.sha256)
  factory.connections[0].versionchange()
  assert.equal(factory.connections[0].closed, true)
  assert.deepEqual(await store.load(version, asset), data)
  assert.equal(await store.hasConsent(version, 'layout', asset.sha256), true)
  assert.equal(factory.opened.length, 2)
  factory.connections[1].unexpectedClose()
  assert.equal((await store.summary()).available, true); assert.equal(factory.opened.length, 3)
  factory.connections[2].close()
  assert.equal(await store.load(version, asset), null, 'Closed-handle failure remains a graceful miss')
  assert.deepEqual(await store.load(version, asset), data); assert.equal(factory.opened.length, 4)
  factory.connections[0].onclose?.()
  assert.deepEqual(await store.load(version, asset), data); assert.equal(factory.opened.length, 4)
})

test('IndexedDB caller abort rolls back already-staged writes and preserves the true cancellation reason', async () => {
  const { store, factory } = indexedFixture({ maxBytes: 4, maxAssetBytes: 4 })
  await store.save(version, pin(bytes(1)), bytes(1))
  const before = structuredClone(factory.bucket('assets')), controller = new AbortController(), cancelled = new Error('Actual unit caller cancellation.')
  factory.afterOperation = (_tx, name, kind) => { if (name === 'assets' && kind === 'put') { factory.afterOperation = undefined; controller.abort(cancelled) } }
  await assert.rejects(store.save(version, pin(bytes(2)), bytes(2), controller.signal), (error: unknown) => error === cancelled)
  await store.summary()
  assert.deepEqual(factory.bucket('assets'), before); assert.equal(factory.rollbacks, 1)
  assert.equal(await store.save(version, pin(bytes(2)), bytes(2)), true)
})

test('IndexedDB cancellation of a queued transaction cannot write after its preceding lock releases', async () => {
  const { store, factory } = indexedFixture({ hash: async (data) => sha(data) })
  await store.save(version, pin(bytes(1)), bytes(1))
  const before = structuredClone(factory.bucket('assets')), controller = new AbortController(), cancelled = new Error('Queued caller cancellation.')
  const blocker = factory.connections[0].transaction(['assets'], 'readwrite') as unknown as UnitTransaction
  factory.beforeCommit = (tx) => {
    if (tx !== blocker) return
    assert.ok(factory.transactions.some((pending) => pending !== blocker && pending.state === 'queued'))
    factory.beforeCommit = undefined; controller.abort(cancelled)
  }
  await assert.rejects(store.save(version, pin(bytes(2)), bytes(2), controller.signal), (error: unknown) => error === cancelled)
  await store.summary()
  assert.deepEqual(factory.bucket('assets'), before); assert.equal(factory.rollbacks, 1)
  assert.equal(await store.save(version, pin(bytes(2)), bytes(2)), true)
})

test('IndexedDB clear reports failure and atomically rolls back both isolated stores', async () => {
  const { store, factory } = indexedFixture(), asset = pin(bytes(1))
  await store.save(version, asset, bytes(1)); await store.consent(version, 'layout', asset.sha256)
  const assets = structuredClone(factory.bucket('assets')), consents = structuredClone(factory.bucket('consents')), projects = structuredClone(factory.projects)
  factory.failNext('consents', 'clear')
  await assert.rejects(store.clear(), { name: 'EngineCacheClearError', message: /was not cleared/u })
  assert.deepEqual(factory.bucket('assets'), assets); assert.deepEqual(factory.bucket('consents'), consents)
  assert.deepEqual(factory.projects, projects); assert.equal(factory.rollbacks, 1)
  assert.equal((await store.summary()).available, false)
  await store.clear()
  assert.deepEqual(await store.summary(), { available: true, bytes: 0, entries: 0, versions: [] })
  assert.equal(factory.bucket('consents').size, 0); assert.deepEqual(factory.projects, projects)
})

test('storage implementation has no project-database imports, global cache clearing or service-worker deletion', () => {
  const source = readFileSync(new URL('./engineAssetStore.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\bimport\b|LATEX_DATABASE|projectStore|deleteDatabase|\bcaches\b|serviceWorker|localStorage/u)
  assert.match(source, /new Blob\(\[copy\]\)/u, 'IndexedDB stores immutable Blobs; summaries/eviction need not materialize ArrayBuffers')
})
