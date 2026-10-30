import { LATEX_DATABASE, LATEX_LIMITS, type LatexAsset, type LatexCheckpoint, type LatexProject, type LatexProof } from './types.ts'
import { imageDimensions } from './projectArchive.ts'
import { isRecord, LatexProjectError, projectSnapshotHash, sha256, utf8Bytes, validateLatexProject } from './project.ts'

export const LOCAL_LATEX_LIMITS = { projects: 8, checkpointsPerProject: 6, bytes: 32 * 1024 * 1024, recordsPerStore: 512 } as const
const names = ['projects', 'assets', 'checkpoints', 'artifacts'] as const
type StoreName = typeof names[number]
type AssetReference = { id: string; path: string; mediaType: LatexAsset['mediaType']; size: number; sha256: string }
type StoredProject = { storageVersion: 1; id: string; project: Omit<LatexProject, 'assets'> & { assets: AssetReference[] } }
type StoredAsset = { storageVersion: 1; key: string; projectId: string; asset: LatexAsset; sha256: string }
type StoredCheckpoint = { storageVersion: 1; id: string; checkpoint: LatexCheckpoint }
type StoredProof = { storageVersion: 1; projectId: string; proof: LatexProof; snapshot: LatexProject }
export type LocalLatexWorkspace = { projects: LatexProject[]; checkpoints: LatexCheckpoint[]; proofs: LatexProof[]; proofSnapshots: Record<string, LatexProject>; protectedRecords: string[] }
export type LatexSaveAcknowledgment = { projectId: string; revision: number; savedAt: string }

export class LatexStorageError extends Error {
  code: 'unavailable' | 'conflict' | 'protected' | 'capacity'
  constructor(message: string, code: LatexStorageError['code'] = 'unavailable') { super(message); this.name = 'LatexStorageError'; this.code = code }
}

function completion(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new LatexStorageError('The device-storage transaction did not commit.'))
    transaction.onerror = () => { /* onabort reports the final transaction result. */ }
  })
}
function records(store: IDBObjectStore) {
  return new Promise<{ key: IDBValidKey; value: unknown }[]>((resolve, reject) => {
    const values: { key: IDBValidKey; value: unknown }[] = []
    const cursor = store.openCursor()
    cursor.onerror = () => reject(cursor.error)
    cursor.onsuccess = () => {
      const item = cursor.result
      if (!item) { resolve(values); return }
      if (values.length >= LOCAL_LATEX_LIMITS.recordsPerStore) { reject(new LatexStorageError('The local store exceeds its record bound. Originals were preserved.', 'capacity')); return }
      values.push({ key: item.primaryKey, value: item.value }); item.continue()
    }
  })
}

function readCheckpoint(value: unknown): LatexCheckpoint {
  if (!isRecord(value) || value.storageVersion !== 1 || Object.keys(value).some((field) => !['storageVersion', 'id', 'checkpoint'].includes(field)) || typeof value.id !== 'string' || !isRecord(value.checkpoint)) throw new LatexStorageError('An unsupported checkpoint was preserved.', 'protected')
  const checkpoint = value.checkpoint
  if (Object.keys(checkpoint).some((field) => !['id', 'label', 'project', 'createdAt'].includes(field)) || checkpoint.id !== value.id || typeof checkpoint.label !== 'string' || checkpoint.label.length > 120 || typeof checkpoint.createdAt !== 'string' || !Number.isFinite(Date.parse(checkpoint.createdAt))) throw new LatexStorageError('An invalid checkpoint was preserved.', 'protected')
  validateLatexProject(checkpoint.project)
  return checkpoint as LatexCheckpoint
}

export function validateStoredProof(value: unknown): LatexProof {
  if (!isRecord(value) || value.storageVersion !== 1 || Object.keys(value).some((field) => !['storageVersion', 'projectId', 'proof', 'snapshot'].includes(field)) || !isRecord(value.proof)) throw new LatexStorageError('An unsupported proof record was preserved.', 'protected')
  const proof = value.proof
  const snapshot = validateLatexProject(value.snapshot)
  if (Object.keys(proof).some((field) => !['status', 'operationKey', 'projectId', 'revision', 'snapshotHash', 'engine', 'profileVersion', 'pdf', 'diagnostics', 'log', 'syncAvailable', 'createdAt', 'data'].includes(field))) throw new LatexStorageError('Unsupported proof metadata was preserved.', 'protected')
  const hash = /^[a-f0-9]{64}$/u
  if (proof.status !== 'ready' || proof.projectId !== value.projectId || proof.projectId !== snapshot.id || proof.revision !== snapshot.revision || proof.engine !== snapshot.engine
    || typeof proof.operationKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/u.test(proof.operationKey)
    || typeof proof.projectId !== 'string' || !Number.isSafeInteger(proof.revision) || (proof.revision as number) < 1
    || typeof proof.snapshotHash !== 'string' || !hash.test(proof.snapshotHash) || !['lualatex', 'xelatex', 'pdflatex'].includes(String(proof.engine))
    || typeof proof.profileVersion !== 'string' || proof.profileVersion.length > 512 || typeof proof.createdAt !== 'string' || !Number.isFinite(Date.parse(proof.createdAt))
    || typeof proof.syncAvailable !== 'boolean' || typeof proof.log !== 'string' || utf8Bytes(proof.log) > LATEX_LIMITS.logBytes
    || !Array.isArray(proof.diagnostics) || proof.diagnostics.length > 512 || !(proof.data instanceof ArrayBuffer)
    || !isRecord(proof.pdf) || Object.keys(proof.pdf).some((field) => !['id', 'sha256', 'bytes', 'pages'].includes(field)) || typeof proof.pdf.id !== 'string' || typeof proof.pdf.sha256 !== 'string' || !hash.test(proof.pdf.sha256)
    || proof.pdf.bytes !== proof.data.byteLength || proof.data.byteLength < 5 || proof.data.byteLength > LATEX_LIMITS.pdfBytes
    || !Number.isSafeInteger(proof.pdf.pages) || (proof.pdf.pages as number) < 1 || (proof.pdf.pages as number) > LATEX_LIMITS.pages) throw new LatexStorageError('An invalid local proof was preserved without being displayed.', 'protected')
  for (const diagnostic of proof.diagnostics) if (!isRecord(diagnostic) || !['error', 'warning', 'info'].includes(String(diagnostic.severity))
    || Object.keys(diagnostic).some((field) => !['severity', 'message', 'file', 'line', 'column', 'code', 'help'].includes(field))
    || typeof diagnostic.message !== 'string' || utf8Bytes(diagnostic.message) > 16 * 1024
    || (diagnostic.file !== undefined && typeof diagnostic.file !== 'string')
    || (diagnostic.line !== undefined && (!Number.isSafeInteger(diagnostic.line) || (diagnostic.line as number) < 1))) throw new LatexStorageError('Invalid local diagnostics were preserved.', 'protected')
  if (String.fromCharCode(...new Uint8Array(proof.data, 0, 5)) !== '%PDF-') throw new LatexStorageError('The stored artifact is not a PDF.', 'protected')
  return proof as LatexProof
}

function hydrateProject(value: unknown, assetRecords: readonly { value: unknown }[]) {
  if (!isRecord(value) || value.storageVersion !== 1 || Object.keys(value).some((field) => !['storageVersion', 'id', 'project'].includes(field)) || typeof value.id !== 'string' || !isRecord(value.project)
    || value.project.id !== value.id || !Array.isArray(value.project.assets)) throw new LatexStorageError('An unsupported project record was preserved.', 'protected')
  const assets: LatexAsset[] = []
  for (const reference of value.project.assets) {
    if (!isRecord(reference) || typeof reference.id !== 'string' || typeof reference.path !== 'string' || !Number.isSafeInteger(reference.size)
      || Object.keys(reference).some((field) => !['id', 'path', 'mediaType', 'size', 'sha256'].includes(field))
      || (reference.size as number) < 1 || (reference.size as number) > LATEX_LIMITS.uploadBytes || typeof reference.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(reference.sha256)) throw new LatexStorageError('An invalid asset reference was preserved.', 'protected')
    const assetRecord = assetRecords.find(({ value: candidate }) => isRecord(candidate) && candidate.key === `${value.id}:${reference.id}`)?.value
    if (!isRecord(assetRecord) || assetRecord.storageVersion !== 1 || Object.keys(assetRecord).some((field) => !['storageVersion', 'key', 'projectId', 'asset', 'sha256'].includes(field)) || assetRecord.projectId !== value.id || assetRecord.sha256 !== reference.sha256 || !isRecord(assetRecord.asset)) throw new LatexStorageError(`Missing or unsupported stored asset: ${reference.path}. Originals were preserved.`, 'protected')
    const asset = assetRecord.asset
    if (asset.id !== reference.id || asset.path !== reference.path || asset.mediaType !== reference.mediaType || !(asset.blob instanceof Blob) || asset.blob.size !== reference.size) throw new LatexStorageError('Stored asset identity or bytes disagree with the project.', 'protected')
    assets.push(asset as LatexAsset)
  }
  return validateLatexProject({ ...value.project, assets })
}

/** CAS is checked inside the same readwrite transaction as all project/asset writes. */
export function assertExpectedRevision(current: { id: string; revision: number } | null, expected: number | null, next: { id: string; revision: number }) {
  if ((current?.revision ?? null) !== expected || (current && current.id !== next.id)) throw new LatexStorageError('Another tab saved this project. Your in-memory writing was kept. Reload the stored copy or save your writing as a new project.', 'conflict')
  if (current && next.revision < current.revision) throw new LatexStorageError('An older source revision cannot replace a newer stored project.', 'conflict')
}

/** Conservative logical byte budget, including checkpoints and PDF bytes, not a quota availability promise. */
export function storedRecordBytes(value: unknown, seen = new Set<object>(), depth = 0): number {
  if (typeof value === 'string') return utf8Bytes(value)
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return 8
  if (value instanceof Blob) return value.size
  if (value instanceof ArrayBuffer) return value.byteLength
  if (ArrayBuffer.isView(value)) return value.byteLength
  if (typeof value !== 'object' || depth > 12 || seen.has(value)) return LOCAL_LATEX_LIMITS.bytes
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return LOCAL_LATEX_LIMITS.bytes
  seen.add(value)
  let bytes = 64
  for (const [key, item] of Object.entries(value)) {
    bytes += utf8Bytes(key) + storedRecordBytes(item, seen, depth + 1)
    if (bytes > LOCAL_LATEX_LIMITS.bytes) return bytes
  }
  seen.delete(value)
  return bytes
}

function checkpointPrune(values: { key: IDBValidKey; value: unknown }[], projectId: string, incoming: StoredCheckpoint | null) {
  const valid: { key: IDBValidKey; checkpoint: LatexCheckpoint }[] = []
  let protectedCount = 0
  for (const item of values) {
    if (!isRecord(item.value) || !isRecord(item.value.checkpoint) || !isRecord(item.value.checkpoint.project) || item.value.checkpoint.project.id !== projectId) continue
    try { valid.push({ key: item.key, checkpoint: readCheckpoint(item.value) }) } catch { protectedCount++ }
  }
  valid.sort((a, b) => Date.parse(a.checkpoint.createdAt) - Date.parse(b.checkpoint.createdAt))
  const excess = valid.length + protectedCount + (incoming ? 1 : 0) - LOCAL_LATEX_LIMITS.checkpointsPerProject
  if (excess > valid.length) throw new LatexStorageError('Protected checkpoint records fill the bounded history. Originals were not deleted.', 'capacity')
  return valid.slice(0, Math.max(0, excess)).map((item) => item.key)
}

async function prepareProject(project: LatexProject): Promise<{ record: StoredProject; assets: StoredAsset[] }> {
  validateLatexProject(project)
  const refs: AssetReference[] = [], assets: StoredAsset[] = []
  for (const asset of project.assets) {
    const bytes = await asset.blob.arrayBuffer()
    imageDimensions(new Uint8Array(bytes), asset.mediaType)
    const hash = await sha256(bytes)
    refs.push({ id: asset.id, path: asset.path, mediaType: asset.mediaType, size: bytes.byteLength, sha256: hash })
    assets.push({ storageVersion: 1, key: `${project.id}:${asset.id}`, projectId: project.id, asset, sha256: hash })
  }
  return { record: { storageVersion: 1, id: project.id, project: { ...project, assets: refs } }, assets }
}

function storedSourceIdentity(record: StoredProject) {
  const compare = (left: { path: string }, right: { path: string }) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  return JSON.stringify({ mainFile: record.project.mainFile, engine: record.project.engine,
    files: record.project.files.map(({ id, path, content }) => ({ id, path, content })).sort(compare),
    assets: record.project.assets.map(({ id, path, mediaType, size, sha256 }) => ({ id, path, mediaType, size, sha256 })).sort(compare) })
}

export class LatexProjectStore {
  private database: IDBDatabase
  constructor(database: IDBDatabase) { this.database = database }
  close() { this.database.close() }

  async readWorkspace(): Promise<LocalLatexWorkspace> {
    const transaction = this.database.transaction([...names], 'readonly'), committed = completion(transaction)
    let all: Awaited<ReturnType<typeof records>>[]
    try { all = await Promise.all(names.map((name) => records(transaction.objectStore(name)))); await committed }
    catch (error) { try { transaction.abort() } catch { /* Already terminal. */ } await committed.catch(() => {}); throw error }
    this.checkBudget(all)
    const [projectRecords, assetRecords, checkpointRecords, artifactRecords] = all
    const protectedRecords: string[] = [], projects: LatexProject[] = [], checkpoints: LatexCheckpoint[] = [], proofs: LatexProof[] = [], proofSnapshots: Record<string, LatexProject> = {}
    for (const record of projectRecords) {
      try {
        const project = hydrateProject(record.value, assetRecords)
        for (const asset of project.assets) {
          const bytes = await asset.blob.arrayBuffer()
          imageDimensions(new Uint8Array(bytes), asset.mediaType)
          const stored = assetRecords.find(({ value }) => isRecord(value) && value.key === `${project.id}:${asset.id}`)!.value as StoredAsset
          if (await sha256(bytes) !== stored.sha256) throw new Error('The image checksum no longer matches its project.')
        }
        if (projects.length >= LOCAL_LATEX_LIMITS.projects) throw new Error('More projects are stored than this workspace can safely restore.')
        projects.push(project)
      } catch (error) { protectedRecords.push(`Project ${String(record.key)}: ${error instanceof Error ? error.message : 'invalid record'}`) }
    }
    for (const record of checkpointRecords) {
      try { const checkpoint = readCheckpoint(record.value); if (projects.some((project) => project.id === checkpoint.project.id)) checkpoints.push(checkpoint) }
      catch { protectedRecords.push(`Checkpoint ${String(record.key)} was preserved without being applied.`) }
    }
    for (const record of artifactRecords) {
      try {
        const proof = validateStoredProof(record.value), project = projects.find((item) => item.id === proof.projectId)
        const snapshot = isRecord(record.value) ? validateLatexProject(record.value.snapshot) : null
        if (!project || !snapshot || snapshot.id !== proof.projectId || snapshot.revision !== proof.revision || proof.revision > project.revision
          || await projectSnapshotHash(snapshot) !== proof.snapshotHash || await sha256(proof.data) !== proof.pdf.sha256
          || (project.revision === proof.revision && await projectSnapshotHash(project) !== proof.snapshotHash)) throw new Error('Proof identity, source revision or checksum mismatch.')
        proofs.push(proof)
        // A same-revision snapshot was verified against current source above; share its immutable asset identities.
        proofSnapshots[proof.projectId] = project.revision === proof.revision ? project : snapshot
      } catch { protectedRecords.push(`Proof ${String(record.key)} was preserved without being displayed.`) }
    }
    projects.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    checkpoints.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    return { projects, checkpoints, proofs, proofSnapshots, protectedRecords }
  }

  async save(project: LatexProject, expectedRevision: number | null, checkpoint?: LatexCheckpoint): Promise<LatexSaveAcknowledgment> {
    const prepared = await prepareProject(project)
    if (checkpoint) { validateLatexProject(checkpoint.project); if (checkpoint.project.id !== project.id) throw new LatexProjectError('A recovery checkpoint must belong to this project.') }
    const incoming: StoredCheckpoint | null = checkpoint ? { storageVersion: 1, id: checkpoint.id, checkpoint } : null
    const transaction = this.database.transaction([...names], 'readwrite'), committed = completion(transaction)
    try {
      const all = await Promise.all(names.map((name) => records(transaction.objectStore(name))))
      const [projects, assets, checkpoints] = all
      const previous = projects.find((item) => item.key === project.id)
      const current = previous ? hydrateProject(previous.value, assets) : null
      assertExpectedRevision(current, expectedRevision, project)
      if (current?.revision === project.revision && JSON.stringify((previous!.value as StoredProject).project) !== JSON.stringify(prepared.record.project)) throw new LatexStorageError('Changed content must have a new revision. Stored writing was not overwritten.', 'conflict')
      if (!current && projects.length >= LOCAL_LATEX_LIMITS.projects) throw new LatexStorageError('The device holds the maximum eight local projects. Export and explicitly remove a project before saving another.', 'capacity')
      if (incoming && checkpoints.some((item) => item.key === incoming.id)) throw new LatexStorageError('A checkpoint identity already exists. Its original was preserved.', 'protected')
      const prune = checkpointPrune(checkpoints, project.id, incoming)
      const removedAssets = (current?.assets ?? []).filter((asset) => !prepared.assets.some((item) => item.key === `${project.id}:${asset.id}`)).map((asset) => `${project.id}:${asset.id}`)
      const removedAssetKeys = new Set<IDBValidKey>(removedAssets)
      for (const asset of prepared.assets) {
        const original = assets.find((item) => item.key === asset.key)?.value
        if (original && (!isRecord(original) || original.storageVersion !== 1 || !isRecord(original.asset) || !(original.asset.blob instanceof Blob))) throw new LatexStorageError('An unsupported asset record was preserved.', 'protected')
      }
      const next = all.map((values) => [...values])
      next[0] = [...next[0].filter((item) => item.key !== project.id), { key: project.id, value: prepared.record }]
      next[1] = [...next[1].filter((item) => !removedAssetKeys.has(item.key) && !prepared.assets.some((asset) => asset.key === item.key)), ...prepared.assets.map((asset) => ({ key: asset.key, value: asset }))]
      next[2] = [...next[2].filter((item) => !prune.includes(item.key)), ...(incoming ? [{ key: incoming.id, value: incoming }] : [])]
      this.checkBudget(next)
      transaction.objectStore('projects').put(prepared.record)
      for (const key of removedAssets) transaction.objectStore('assets').delete(key)
      for (const asset of prepared.assets) transaction.objectStore('assets').put(asset)
      for (const key of prune) transaction.objectStore('checkpoints').delete(key)
      if (incoming) transaction.objectStore('checkpoints').put(incoming)
      await committed
      return { projectId: project.id, revision: project.revision, savedAt: new Date().toISOString() }
    } catch (error) { try { transaction.abort() } catch { /* A failed transaction may already be aborted. */ } await committed.catch(() => {}); throw error }
  }

  async retainProof(proof: LatexProof, checkpoint: LatexCheckpoint) {
    validateStoredProof({ storageVersion: 1, projectId: proof.projectId, proof, snapshot: checkpoint.project })
    validateLatexProject(checkpoint.project)
    if (checkpoint.project.id !== proof.projectId || checkpoint.project.revision !== proof.revision || await sha256(proof.data) !== proof.pdf.sha256
      || await projectSnapshotHash(checkpoint.project) !== proof.snapshotHash) throw new LatexStorageError('The proof does not belong to the compile checkpoint.', 'protected')
    const incoming: StoredCheckpoint = { storageVersion: 1, id: checkpoint.id, checkpoint }
    const artifact: StoredProof = { storageVersion: 1, projectId: proof.projectId, proof, snapshot: checkpoint.project }
    const compiledSource = await prepareProject(checkpoint.project)
    const transaction = this.database.transaction([...names], 'readwrite'), committed = completion(transaction)
    try {
      const all = await Promise.all(names.map((name) => records(transaction.objectStore(name))))
      const project = all[0].find((item) => item.key === proof.projectId)
      if (!project) throw new LatexStorageError('Save the compiled source revision before retaining its proof locally.')
      const stored = hydrateProject(project.value, all[1])
      if (stored.revision < proof.revision) throw new LatexStorageError('Save the compiled source revision before retaining its proof locally.')
      if (stored.revision === proof.revision && storedSourceIdentity(project.value as StoredProject) !== storedSourceIdentity(compiledSource.record)) throw new LatexStorageError('The stored revision contains different source from this compile snapshot. Its original proof was not replaced; this result is session-only.', 'conflict')
      const original = all[3].find((item) => item.key === proof.projectId)
      if (original && validateStoredProof(original.value).revision > proof.revision) { await committed; return }
      const prune = checkpointPrune(all[2], proof.projectId, incoming)
      const next = all.map((values) => [...values])
      next[2] = [...next[2].filter((item) => !prune.includes(item.key)), { key: checkpoint.id, value: incoming }]
      next[3] = [...next[3].filter((item) => item.key !== proof.projectId), { key: proof.projectId, value: artifact }]
      this.checkBudget(next)
      for (const key of prune) transaction.objectStore('checkpoints').delete(key)
      transaction.objectStore('checkpoints').put(incoming); transaction.objectStore('artifacts').put(artifact)
      await committed
    } catch (error) { try { transaction.abort() } catch { /* Already terminal. */ } await committed.catch(() => {}); throw error }
  }

  async deleteProject(projectId: string, expectedRevision: number) {
    const transaction = this.database.transaction([...names], 'readwrite'), committed = completion(transaction)
    try {
      const all = await Promise.all(names.map((name) => records(transaction.objectStore(name))))
      const original = all[0].find((item) => item.key === projectId)
      if (!original) throw new LatexStorageError('The stored project no longer exists.', 'conflict')
      const current = hydrateProject(original.value, all[1])
      assertExpectedRevision(current, expectedRevision, current)
      transaction.objectStore('projects').delete(projectId)
      for (const asset of current.assets) transaction.objectStore('assets').delete(`${projectId}:${asset.id}`)
      for (const item of all[2]) { try { if (readCheckpoint(item.value).project.id === projectId) transaction.objectStore('checkpoints').delete(item.key) } catch { /* Protected originals are never deleted as a side effect. */ } }
      const proof = all[3].find((item) => item.key === projectId)
      if (proof) { try { validateStoredProof(proof.value); transaction.objectStore('artifacts').delete(projectId) } catch { /* Preserve unsupported proof record. */ } }
      await committed
    } catch (error) { try { transaction.abort() } catch { /* Already terminal. */ } await committed.catch(() => {}); throw error }
  }

  private checkBudget(all: { value: unknown }[][]) {
    let bytes = 0
    for (const records of all) for (const item of records) {
      bytes += 512 + storedRecordBytes(item.value)
      if (bytes > LOCAL_LATEX_LIMITS.bytes) throw new LatexStorageError('The bounded 32 MiB local store is full. Export a source backup; current writing remains in this session.', 'capacity')
    }
  }
}

export function openLatexProjectStore(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<LatexProjectStore> {
  if (!factory) return Promise.reject(new LatexStorageError('IndexedDB is unavailable. Editing and source backups still work in this session.'))
  return new Promise((resolve, reject) => {
    let finished = false
    const operation = factory.open(LATEX_DATABASE, 1)
    operation.onupgradeneeded = () => {
      const database = operation.result
      for (const name of names) if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: name === 'assets' ? 'key' : name === 'artifacts' ? 'projectId' : 'id' })
    }
    operation.onerror = () => { finished = true; reject(new LatexStorageError(operation.error?.name === 'VersionError' ? 'A newer LaTeX database exists. It was not changed; this workspace is session-only.' : 'This browser could not open the local LaTeX store. Your session remains editable.')) }
    operation.onblocked = () => { finished = true; reject(new LatexStorageError('Another tab blocks the local database upgrade. No stored original was changed.')) }
    operation.onsuccess = () => {
      if (finished) { operation.result.close(); return }
      finished = true
      operation.result.onversionchange = () => operation.result.close()
      resolve(new LatexProjectStore(operation.result))
    }
  })
}

// Exposed pure policy functions are exercised without a browser or a running compiler.
export const latexStoreNames: readonly StoreName[] = names
