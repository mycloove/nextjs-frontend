import { proofActionIdentity } from './workspaceIdentity.ts'
import { assertLatexPath } from './project.ts'
import type { LatexEngine, LatexPdfLocation, LatexProof, LatexSyncQuery } from './types.ts'

export type BrowserSyncArtifact = {
  identity: string
  engine: LatexEngine
  data: ArrayBuffer
  parser: ArrayBuffer
  parserSha256: string
  sourceFiles: { path: string; lines: number }[]
}
export type ProofNavigationCandidate = { file: string; line: number; column?: number; locations: LatexPdfLocation[] }
export type ProofNavigationResult = { available: boolean; candidates: ProofNavigationCandidate[]; reason?: string }
export type BrowserSyncWorker = Pick<Worker, 'onmessage' | 'onerror' | 'onmessageerror' | 'postMessage' | 'terminate'>
export type BrowserSyncDependencies = { createWorker?: () => BrowserSyncWorker; timeoutMs?: number }
const abortError = () => new DOMException('Source navigation cancelled', 'AbortError')
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

function readResult(value: unknown): ProofNavigationResult {
  if (!record(value) || typeof value.available !== 'boolean' || !Array.isArray(value.candidates) || value.candidates.length > 32 || (value.reason !== undefined && (typeof value.reason !== 'string' || value.reason.length > 512))) throw new Error('The source navigation worker returned an invalid result.')
  for (const candidate of value.candidates) {
    if (!record(candidate) || typeof candidate.file !== 'string' || candidate.file.length > 240 || !Number.isSafeInteger(candidate.line) || (candidate.line as number) < 1 || (candidate.column !== undefined && (!Number.isSafeInteger(candidate.column) || (candidate.column as number) < 1)) || !Array.isArray(candidate.locations) || !candidate.locations.length || candidate.locations.length > 128) throw new Error('The source navigation worker returned an invalid candidate.')
    assertLatexPath(candidate.file)
    for (const location of candidate.locations) if (!record(location) || !['page', 'x', 'y', 'width', 'height'].every((key) => typeof location[key] === 'number' && Number.isFinite(location[key]) && (location[key] as number) >= 0 && (location[key] as number) <= 14_400) || !Number.isSafeInteger(location.page) || (location.page as number) < 1 || (location.width as number) <= 0 || (location.height as number) <= 0) throw new Error('The source navigation worker returned invalid PDF coordinates.')
  }
  return value as ProofNavigationResult
}

/** The worker owns the parsed map; only bounded session bytes stay in the hook. */
export function createBrowserSyncSession(dependencies: BrowserSyncDependencies = {}) {
  let worker: BrowserSyncWorker | undefined, identity: string | undefined, sequence = 0
  let pending: { reject: (error: Error) => void; cleanup: () => void } | undefined
  const dispose = () => {
    const previous = pending; pending = undefined
    previous?.cleanup(); previous?.reject(abortError())
    worker?.terminate(); worker = undefined; identity = undefined
  }
  return {
    dispose,
    async query(proof: LatexProof, artifact: BrowserSyncArtifact, query: LatexSyncQuery | null, signal?: AbortSignal): Promise<ProofNavigationResult> {
      if (signal?.aborted) throw abortError()
      if (artifact.identity !== proofActionIdentity(proof) || artifact.engine !== proof.engine || proof.runtime !== 'browser') return { available: false, candidates: [], reason: 'This source map belongs to a different compiled proof.' }
      if (pending || identity !== artifact.identity) dispose()
      const fresh = !worker
      worker ??= dependencies.createWorker?.() ?? new Worker(new URL('./browserSynctex.worker.ts', import.meta.url), { type: 'module', name: 'mr-resume-synctex' })
      identity = artifact.identity
      const current = worker, id = ++sequence
      return new Promise<ProofNavigationResult>((resolve, reject) => {
        const abort = () => dispose()
        const timer = setTimeout(() => {
          const active = pending; pending = undefined
          active?.cleanup(); current.terminate(); worker = undefined; identity = undefined
          reject(new Error('Source navigation exceeded its bounded worker deadline.'))
        }, dependencies.timeoutMs ?? (fresh ? 3000 : 500))
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); current.onmessage = null; current.onerror = null; current.onmessageerror = null }
        pending = { reject, cleanup }
        const finish = (error?: Error, result?: ProofNavigationResult) => {
          if (worker !== current || !pending) return
          cleanup(); pending = undefined
          if (error) { current.terminate(); worker = undefined; identity = undefined; reject(error) }
          else resolve(result!)
        }
        signal?.addEventListener('abort', abort, { once: true })
        current.onmessage = ({ data }: MessageEvent<unknown>) => {
          if (!record(data) || data.id !== id || data.identity !== identity) return
          try {
            if (data.ok !== true) throw new Error(typeof data.error === 'string' ? data.error.slice(0, 512) : 'The local SyncTeX map is unavailable.')
            const result = readResult(data.result)
            if ((query && result.available !== !!result.candidates.length) || (!result.available && result.candidates.length) || result.candidates.some((candidate) => candidate.line > (artifact.sourceFiles.find((file) => file.path === candidate.file)?.lines ?? 0) || candidate.locations.some((location) => location.page > proof.pdf.pages))) throw new Error('The local SyncTeX result is outside the captured source or PDF.')
            finish(undefined, result)
          }
          catch (error) { finish(error instanceof Error ? error : new Error('The local SyncTeX map is unavailable.')) }
        }
        current.onerror = (event) => { event.preventDefault(); finish(new Error('The isolated source navigation worker could not run.')) }
        current.onmessageerror = () => finish(new Error('The source navigation worker returned unreadable data.'))
        try {
          if (fresh) {
            const data = artifact.data.slice(0), parser = artifact.parser.slice(0), pdf = proof.data.slice(0)
            current.postMessage({ id, identity, query, artifact: { ...artifact, sourceFiles: artifact.sourceFiles.map((file) => ({ ...file })), data, parser }, pdf }, [data, parser, pdf])
          } else current.postMessage({ id, identity, query })
        } catch (error) { finish(error instanceof Error ? error : new Error('The local SyncTeX map could not be transferred.')) }
      })
    },
  }
}

export async function inspectBrowserSyncArtifact(proof: LatexProof, artifact: BrowserSyncArtifact, signal?: AbortSignal, dependencies?: BrowserSyncDependencies) {
  const session = createBrowserSyncSession(dependencies)
  try { return (await session.query(proof, artifact, null, signal)).available }
  catch (error) { if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error; return false }
  finally { session.dispose() }
}
