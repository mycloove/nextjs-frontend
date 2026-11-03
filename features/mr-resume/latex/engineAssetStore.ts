export type EngineAssetPin = { path: string; bytes: number; sha256: string }
export type EngineCacheSummary = { available: boolean; bytes: number; entries: number; versions: string[]; incompleteVersions?: string[]; reason?: string }

export interface EngineAssetStore {
  load(profileVersion: string, asset: EngineAssetPin, signal?: AbortSignal): Promise<ArrayBuffer | null>
  save(profileVersion: string, asset: EngineAssetPin, data: ArrayBuffer, signal?: AbortSignal): Promise<boolean>
  summary(): Promise<EngineCacheSummary>
  /** Resolves only after a committed clear; unavailable persistence rejects. */
  clear(): Promise<void>
  hasConsent(profileVersion: string, groupID: string, groupHash: string): Promise<boolean>
  consent(profileVersion: string, groupID: string, groupHash: string): Promise<void>
}

type AssetMetadata = EngineAssetPin & { key: string; profileVersion: string; lastUsed: number; incomplete?: true }
type StoredAsset = AssetMetadata & { data: Blob }
type StoredConsent = { profileVersion: string; groupID: string; groupHash: string; lastUsed?: number }

/** An engine-only backend; write's eviction callback runs in its atomic write transaction. */
export interface EngineAssetBackend {
  read(key: string, signal?: AbortSignal): Promise<unknown>
  entries(): Promise<AssetMetadata[]>
  write(asset: StoredAsset, evict: (entries: AssetMetadata[]) => string[], signal?: AbortSignal): Promise<void>
  remove(key: string, signal?: AbortSignal): Promise<void>
  touch(key: string, lastUsed: number, signal?: AbortSignal): Promise<void>
  clear(): Promise<void>
  hasConsent(key: string, lastUsed?: number): Promise<boolean>
  consent(key: string, value: StoredConsent): Promise<void>
}

export type EngineAssetStoreOptions = {
  backend?: EngineAssetBackend | null
  open?: () => Promise<EngineAssetBackend>
  indexedDB?: IDBFactory | null
  now?: () => number
  hash?: (data: ArrayBuffer) => Promise<string>
  maxBytes?: number
  maxAssetBytes?: number
}

// This database never opens or migrates the workspace's project database.
const databaseName = 'mr-resume:latex:engine-assets:v1'
const stores = ['assets', 'consents'] as const
const limits = { bytes: 256 * 1024 * 1024, assetBytes: 128 * 1024 * 1024, entries: 1024, consents: 512 }
const hex = /^[a-f0-9]{64}$/iu
const identifier = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(value)
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const assetKey = (version: string, hash: string) => `${version}:${hash}`
const consentKey = (version: string, group: string, hash: string) => `${version}:${group}:${hash}`
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

function readPin(value: unknown, maxBytes = limits.assetBytes): EngineAssetPin | null {
  if (!record(value) || Object.keys(value).some((key) => !['path', 'bytes', 'sha256'].includes(key))
    || typeof value.path !== 'string' || value.path.length > 512
    || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/u.test(value.path)
    || !Number.isSafeInteger(value.bytes) || (value.bytes as number) < 1 || (value.bytes as number) > maxBytes
    || typeof value.sha256 !== 'string' || !hex.test(value.sha256)) return null
  return { path: value.path, bytes: value.bytes as number, sha256: value.sha256.toLowerCase() }
}

function readAsset(value: unknown): StoredAsset | null {
  if (!record(value) || Object.keys(value).some((key) => !['key', 'profileVersion', 'path', 'bytes', 'sha256', 'lastUsed', 'data', 'incomplete'].includes(key))
    || !identifier(value.profileVersion) || !(value.data instanceof Blob) || !Number.isSafeInteger(value.lastUsed) || (value.lastUsed as number) < 0
    || (value.incomplete !== undefined && value.incomplete !== true)) return null
  const pin = readPin({ path: value.path, bytes: value.bytes, sha256: value.sha256 })
  if (!pin || value.sha256 !== pin.sha256 || value.key !== assetKey(value.profileVersion, pin.sha256) || value.data.size !== pin.bytes) return null
  return { ...pin, key: value.key as string, profileVersion: value.profileVersion, lastUsed: value.lastUsed as number, data: value.data,
    ...(value.incomplete ? { incomplete: true } : {}) }
}

function readConsent(value: unknown, key: unknown): StoredConsent | null {
  if (!record(value) || Object.keys(value).some((field) => !['profileVersion', 'groupID', 'groupHash', 'lastUsed'].includes(field))
    || !identifier(value.profileVersion) || !identifier(value.groupID, 128) || typeof value.groupHash !== 'string' || !hex.test(value.groupHash)
    || (value.lastUsed !== undefined && (!Number.isSafeInteger(value.lastUsed) || (value.lastUsed as number) < 0))
    || consentKey(value.profileVersion, value.groupID, value.groupHash.toLowerCase()) !== key) return null
  return { profileVersion: value.profileVersion, groupID: value.groupID, groupHash: value.groupHash.toLowerCase(), lastUsed: value.lastUsed as number | undefined }
}

function abortError(signal?: AbortSignal) { return signal?.reason ?? new DOMException('Engine asset operation cancelled.', 'AbortError') }
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw abortError(signal) }
function errorName(error: unknown) { return record(error) && typeof error.name === 'string' ? error.name : '' }

function withAbort<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(abortError(signal)) }
    signal.addEventListener('abort', abort, { once: true })
    pending.then((value) => { signal.removeEventListener('abort', abort); if (signal.aborted) reject(abortError(signal)); else resolve(value) },
      (error: unknown) => { signal.removeEventListener('abort', abort); reject(signal.aborted ? abortError(signal) : error) })
    if (signal.aborted) abort()
  })
}

function unavailableReason(error: unknown) {
  const name = errorName(error)
  if (name === 'QuotaExceededError') return 'Engine cache storage is full or its quota is unavailable. Network assets remain usable.'
  if (name === 'EngineCacheBlockedError') return 'Another tab blocks engine cache storage. Network assets remain usable.'
  if (name === 'TimeoutError') return 'Engine cache storage did not open in time. Network assets remain usable.'
  return 'Engine cache storage or integrity checking is unavailable. Network assets remain usable.'
}

async function digest(data: ArrayBuffer) {
  if (!globalThis.crypto?.subtle) throw new Error('Engine asset integrity checking is unavailable.')
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function evictions(entries: AssetMetadata[], incoming: StoredAsset, budget: number) {
  const candidates = entries.filter((entry) => entry.key !== incoming.key)
  const versions = new Map<string, number>()
  for (const entry of [...candidates, incoming]) {
    versions.set(entry.profileVersion, Math.max(versions.get(entry.profileVersion) ?? 0, entry.lastUsed))
  }
  const newest = [incoming.profileVersion, ...[...versions].filter(([version]) => version !== incoming.profileVersion)
    .sort((a, b) => b[1] - a[1] || compare(a[0], b[0])).map(([version]) => version)]
  const rank = new Map(newest.map((version, index) => [version, index]))
  // Evict older working sets first. If the newest two cached sets fit, every
  // asset in both survives. Otherwise prefer one complete newest set, not two
  // misleading manifest/asset anchors; removals mark surviving sets incomplete.
  candidates.sort((a, b) => rank.get(b.profileVersion)! - rank.get(a.profileVersion)!
    || a.lastUsed - b.lastUsed || compare(a.key, b.key))
  let bytes = candidates.reduce((sum, entry) => sum + entry.bytes, incoming.bytes), count = candidates.length + 1
  const removed: string[] = []
  for (const entry of candidates) {
    if (bytes <= budget && count <= limits.entries) break
    removed.push(entry.key); bytes -= entry.bytes; count--
  }
  return removed
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Engine cache request failed.'))
  })
}

function indexedBackend(database: IDBDatabase, invalidate: () => void): EngineAssetBackend {
  async function transaction<T>(names: readonly string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    checkAbort(signal)
    let tx: IDBTransaction
    try { tx = database.transaction([...names], mode) }
    catch (error) { if (errorName(error) === 'InvalidStateError') invalidate(); throw error }
    const committed = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? new Error('Engine cache transaction aborted.'))
      tx.onerror = () => { /* onabort reports the final transaction failure. */ }
    })
    void committed.catch(() => {})
    const abort = () => { try { tx.abort() } catch { /* Already terminal. */ } }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const result = await work(tx)
      await committed
      checkAbort(signal)
      return result
    } catch (error) {
      abort(); await committed.catch(() => {}); checkAbort(signal)
      // Aborted queued requests can mask the originating quota/storage error.
      throw tx.error ?? error
    } finally { signal?.removeEventListener('abort', abort) }
  }

  async function scan(store: IDBObjectStore): Promise<AssetMetadata[]> {
    // A native count bounds decoding work. Reset only this engine bucket when
    // corrupt/external records exceed the cap, instead of rolling cleanup back.
    if (await requestValue(store.count()) > limits.entries) { await requestValue(store.clear()); return [] }
    const affected = new Set<string>()
    const metadata = await new Promise<AssetMetadata[]>((resolve, reject) => {
      const entries: AssetMetadata[] = []
      let seen = 0, bytes = 0
      const request = store.openCursor()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) { resolve(entries); return }
        if (++seen > limits.entries) { requestValue(store.clear()).then(() => resolve([]), reject); return }
        const asset = readAsset(cursor.value)
        if (!asset || asset.key !== cursor.primaryKey) {
          // Attribute removals only to bounded canonical primary keys, not
          // the untrusted version/flag fields of a malformed record.
          const parts = typeof cursor.primaryKey === 'string' && cursor.primaryKey.length <= 321 ? cursor.primaryKey.split(':') : []
          if (parts.length === 2 && identifier(parts[0]) && hex.test(parts[1]) && parts[1] === parts[1].toLowerCase()) affected.add(parts[0])
          cursor.delete()
        }
        else {
          bytes += asset.bytes
          if (bytes > limits.bytes) { requestValue(store.clear()).then(() => resolve([]), reject); return }
          entries.push({ key: asset.key, profileVersion: asset.profileVersion, path: asset.path, bytes: asset.bytes, sha256: asset.sha256,
            lastUsed: asset.lastUsed, ...(asset.incomplete ? { incomplete: true } : {}) })
        }
        cursor.continue()
      }
    })
    await markIncomplete(store, metadata, affected)
    return metadata
  }

  async function markIncomplete(store: IDBObjectStore, entries: AssetMetadata[], versions: Set<string>) {
    for (const version of versions) {
      const anchor = entries.filter((entry) => entry.profileVersion === version)
        .sort((a, b) => b.lastUsed - a.lastUsed || compare(a.key, b.key))[0]
      if (!anchor || anchor.incomplete) continue
      const asset = readAsset(await requestValue(store.get(anchor.key)))
      if (asset) { store.put({ ...asset, incomplete: true }); anchor.incomplete = true }
    }
  }

  async function scanConsents(store: IDBObjectStore): Promise<(StoredConsent & { key: string })[]> {
    if (await requestValue(store.count()) > limits.consents) { await requestValue(store.clear()); return [] }
    return new Promise((resolve, reject) => {
      const entries: (StoredConsent & { key: string })[] = []
      let seen = 0
      const request = store.openCursor()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) { resolve(entries); return }
        if (++seen > limits.consents) { requestValue(store.clear()).then(() => resolve([]), reject); return }
        const value = readConsent(cursor.value, cursor.primaryKey)
        if (!value) cursor.delete()
        else entries.push({ ...value, key: cursor.primaryKey as string })
        cursor.continue()
      }
    })
  }

  return {
    read: (key, signal) => transaction(['assets'], 'readonly', (tx) => requestValue(tx.objectStore('assets').get(key)), signal),
    entries: () => transaction(['assets'], 'readwrite', (tx) => scan(tx.objectStore('assets'))),
    write: (asset, evict, signal) => transaction(['assets'], 'readwrite', async (tx) => {
      const store = tx.objectStore('assets'), entries = await scan(store)
      const removed = new Set(evict(entries)), affected = new Set(entries.filter((entry) => removed.has(entry.key)).map((entry) => entry.profileVersion))
      for (const key of removed) store.delete(key)
      await markIncomplete(store, entries.filter((entry) => !removed.has(entry.key) && entry.key !== asset.key), affected)
      store.put({ ...asset, ...(affected.has(asset.profileVersion) || entries.some((entry) => entry.profileVersion === asset.profileVersion && entry.incomplete)
        ? { incomplete: true } : {}) })
    }, signal),
    remove: (key, signal) => transaction(['assets'], 'readwrite', async (tx) => {
      const store = tx.objectStore('assets')
      store.delete(key)
      await markIncomplete(store, await scan(store), new Set([key.split(':')[0]]))
    }, signal),
    touch: (key, lastUsed, signal) => transaction(['assets'], 'readwrite', async (tx) => {
      const store = tx.objectStore('assets'), asset = readAsset(await requestValue(store.get(key)))
      if (asset) store.put({ ...asset, lastUsed: Math.max(lastUsed, asset.lastUsed) })
      else store.delete(key)
    }, signal),
    clear: () => transaction(stores, 'readwrite', (tx) => { for (const name of stores) tx.objectStore(name).clear() }),
    hasConsent: (key, lastUsed) => transaction(['consents'], 'readwrite', async (tx) => {
      const store = tx.objectStore('consents'), value: unknown = await requestValue(store.get(key))
      const consent = readConsent(value, key)
      if (consent) {
        if (lastUsed !== undefined) store.put({ ...consent, lastUsed: Math.max(lastUsed, consent.lastUsed ?? 0) }, key)
        return true
      }
      if (value !== undefined) store.delete(key)
      return false
    }),
    consent: (key, value) => transaction(['consents'], 'readwrite', async (tx) => {
      const store = tx.objectStore('consents')
      const entries = await scanConsents(store), versions = new Map<string, number>()
      for (const entry of entries) versions.set(entry.profileVersion, Math.max(versions.get(entry.profileVersion) ?? 0, entry.lastUsed ?? 0))
      const recent = new Set([value.profileVersion, ...[...versions].filter(([version]) => version !== value.profileVersion)
        .sort((a, b) => b[1] - a[1] || compare(a[0], b[0])).slice(0, 1).map(([version]) => version)])
      // A new group hash supersedes its previous approval. At capacity, discard
      // obsolete versions before LRU approvals in the two recent versions.
      const superseded = entries.filter((entry) => entry.profileVersion === value.profileVersion && entry.groupID === value.groupID && entry.key !== key)
      for (const entry of superseded) store.delete(entry.key)
      const candidates = entries.filter((entry) => entry.key !== key && !superseded.includes(entry))
        .sort((a, b) => Number(recent.has(a.profileVersion)) - Number(recent.has(b.profileVersion))
          || (a.lastUsed ?? 0) - (b.lastUsed ?? 0) || compare(a.key, b.key))
      let count = candidates.length + 1
      for (const entry of candidates) { if (count <= limits.consents) break; store.delete(entry.key); count-- }
      store.put(value, key)
    }),
  }
}

function openIndexedBackend(factory: IDBFactory | null | undefined, invalidate: () => void): Promise<EngineAssetBackend> {
  if (!factory) return Promise.reject(new Error('IndexedDB is unavailable.'))
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1)
    let finished = false
    const timer = setTimeout(() => fail(new DOMException('Engine cache open timed out.', 'TimeoutError')), 10_000)
    function fail(error: unknown) { if (!finished) { finished = true; clearTimeout(timer); reject(error) } }
    request.onupgradeneeded = () => {
      if (finished) { try { request.transaction?.abort() } catch { /* Already terminal. */ }; return }
      const database = request.result
      if (!database.objectStoreNames.contains('assets')) database.createObjectStore('assets', { keyPath: 'key' })
      if (!database.objectStoreNames.contains('consents')) database.createObjectStore('consents')
    }
    request.onerror = () => fail(request.error)
    request.onblocked = () => fail(new DOMException('Engine cache upgrade blocked.', 'EngineCacheBlockedError'))
    request.onsuccess = () => {
      const database = request.result
      if (finished) { database.close(); return }
      finished = true; clearTimeout(timer)
      const close = () => { database.close(); invalidate() }
      database.onversionchange = close
      database.onclose = invalidate
      resolve(indexedBackend(database, close))
    }
  })
}

/** Only public engine pins belong here. No project/source data or in-memory fallback cache. */
export function createEngineAssetStore(options: EngineAssetStoreOptions = {}): EngineAssetStore {
  const requestedBudget = options.maxBytes ?? limits.bytes, requestedAssetBudget = options.maxAssetBytes ?? limits.assetBytes
  const budget = Number.isSafeInteger(requestedBudget) && requestedBudget > 0 ? Math.min(requestedBudget, limits.bytes) : 0
  const assetBudget = Number.isSafeInteger(requestedAssetBudget) && requestedAssetBudget > 0 ? Math.min(requestedAssetBudget, limits.assetBytes, budget) : 0
  const hash = options.hash ?? digest, now = options.now ?? Date.now
  let opening: Promise<EngineAssetBackend> | undefined, reason: string | undefined, reconnecting = false, lastUsed = -1, generation = 0

  function backend() {
    // Individual cancellation must not cancel/poison another caller's shared open.
    if (opening) return opening
    // One bounded open per operation; retry only on a subsequent operation, not
    // in a loop. Late old handles cannot invalidate a newer connection.
    const invalidate = () => { if (opening === pending) { opening = undefined; reconnecting = true } }
    const pending: Promise<EngineAssetBackend> = Promise.resolve().then(() => {
      if (!Number.isSafeInteger(budget) || budget < 1 || !Number.isSafeInteger(assetBudget) || assetBudget < 1) throw new Error('Invalid engine cache budget.')
      if (options.open) return options.open()
      if (options.backend !== undefined) { if (!options.backend) throw new Error('Engine cache backend is unavailable.'); return options.backend }
      return openIndexedBackend(options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB, invalidate)
    }).then((store) => {
      if (opening === pending && reconnecting) { reason = undefined; reconnecting = false }
      return store
    })
    opening = pending
    void pending.catch(invalidate)
    return pending
  }
  function timestamp() {
    const time = now()
    if (!Number.isSafeInteger(time) || time < 0 || lastUsed >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid engine cache clock.')
    return lastUsed = Math.max(time, lastUsed + 1)
  }
  async function attempt<T>(fallback: T, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    checkAbort(signal)
    try { return await work() }
    catch (error) { checkAbort(signal); if (errorName(error) === 'AbortError') throw error; reason = unavailableReason(error); return fallback }
  }

  return {
    async load(profileVersion, asset, signal) {
      checkAbort(signal)
      const pin = readPin(asset, assetBudget)
      if (!identifier(profileVersion) || !pin) return null
      return attempt<ArrayBuffer | null>(null, async () => {
        const store = await withAbort(backend(), signal), key = assetKey(profileVersion, pin.sha256)
        const value = await withAbort(store.read(key, signal), signal)
        if (value === null || value === undefined) return null
        const stored = readAsset(value)
        if (!stored || stored.key !== key || stored.bytes !== pin.bytes) { await withAbort(store.remove(key, signal), signal); return null }
        // Blob bytes and hashing are awaited outside any IndexedDB transaction.
        const data = await withAbort(stored.data.arrayBuffer(), signal)
        if (data.byteLength !== pin.bytes || (await withAbort(hash(data), signal)).toLowerCase() !== pin.sha256) { await withAbort(store.remove(key, signal), signal); return null }
        // A failed LRU touch must not discard already verified, usable bytes.
        await attempt(false, async () => { await withAbort(store.touch(key, timestamp(), signal), signal); reason = undefined; return true }, signal)
        return data
      }, signal)
    },
    async save(profileVersion, asset, data, signal) {
      checkAbort(signal)
      const pin = readPin(asset, assetBudget), epoch = generation
      if (!identifier(profileVersion) || !pin || !(data instanceof ArrayBuffer) || data.byteLength !== pin.bytes) return false
      return attempt(false, async () => {
        const copy = data.slice(0)
        if ((await withAbort(hash(copy), signal)).toLowerCase() !== pin.sha256 || epoch !== generation) return false
        const store = await withAbort(backend(), signal)
        if (epoch !== generation) return false
        const incoming: StoredAsset = { key: assetKey(profileVersion, pin.sha256), profileVersion, path: pin.path, bytes: pin.bytes, sha256: pin.sha256, lastUsed: timestamp(), data: new Blob([copy]) }
        await withAbort(store.write(incoming, (entries) => evictions(entries, incoming, budget), signal), signal)
        reason = undefined
        return true
      }, signal)
    },
    async summary() {
      const entries = await attempt<AssetMetadata[] | null>(null, async () => (await backend()).entries())
      if (!entries) return { available: false, bytes: 0, entries: 0, versions: [], reason }
      const versions = new Map<string, number>()
      for (const entry of entries) versions.set(entry.profileVersion, Math.max(versions.get(entry.profileVersion) ?? 0, entry.lastUsed))
      // This conservative persisted warning records removals, not manifest
      // completeness. Even unflagged presence is never an offline-ready claim;
      // the caller must load every required source-pinned asset.
      const incompleteVersions = [...new Set(entries.filter((entry) => entry.incomplete).map((entry) => entry.profileVersion))].sort(compare)
      return { available: !reason, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), entries: entries.length,
        versions: [...versions].sort((a, b) => b[1] - a[1] || compare(a[0], b[0])).map(([version]) => version),
        ...(incompleteVersions.length ? { incompleteVersions } : {}), ...(reason ? { reason } : {}) }
    },
    async clear() {
      generation++
      try { await (await backend()).clear(); reason = undefined }
      catch (error) {
        reason = unavailableReason(error)
        const failure = new Error(`Engine cache was not cleared. ${reason}`)
        failure.name = 'EngineCacheClearError'
        throw failure
      }
    },
    async hasConsent(profileVersion, groupID, groupHash) {
      if (!identifier(profileVersion) || !identifier(groupID, 128) || typeof groupHash !== 'string' || !hex.test(groupHash)) return false
      return attempt(false, async () => (await backend()).hasConsent(consentKey(profileVersion, groupID, groupHash.toLowerCase()), timestamp()))
    },
    async consent(profileVersion, groupID, groupHash) {
      if (!identifier(profileVersion) || !identifier(groupID, 128) || typeof groupHash !== 'string' || !hex.test(groupHash)) return
      const epoch = generation, normalized = groupHash.toLowerCase()
      await attempt(undefined, async () => {
        const store = await backend()
        if (epoch === generation) await store.consent(consentKey(profileVersion, groupID, normalized), { profileVersion, groupID, groupHash: normalized, lastUsed: timestamp() })
      })
    },
  }
}

// Importing the singleton does not open a database or retain asset bytes.
export const engineAssetStore: EngineAssetStore = createEngineAssetStore()
