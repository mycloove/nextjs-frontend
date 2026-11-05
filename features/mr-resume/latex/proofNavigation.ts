import { syncLatexProof } from './compileTransport.ts'
import { createBrowserSyncSession, type BrowserSyncArtifact, type BrowserSyncDependencies, type ProofNavigationResult } from './browserSynctex.ts'
import { readLatexSyncQuery } from './server/contract.ts'
import { proofActionIdentity } from './workspaceIdentity.ts'
import type { LatexProof, LatexSyncQuery, LatexSyncResult } from './types.ts'

export type { ProofNavigationCandidate, ProofNavigationResult } from './browserSynctex.ts'

export function createLatexProofNavigation(dependencies: BrowserSyncDependencies & { syncNative?: (query: LatexSyncQuery, signal?: AbortSignal) => Promise<LatexSyncResult> } = {}) {
  const local = createBrowserSyncSession(dependencies)
  let active: AbortController | undefined
  const dispose = () => { active?.abort(); active = undefined; local.dispose() }
  return {
    dispose,
    async query(proof: LatexProof, artifact: BrowserSyncArtifact | null, input: LatexSyncQuery, signal?: AbortSignal): Promise<ProofNavigationResult> {
      active?.abort()
      const controller = new AbortController(); active = controller
      const abort = () => controller.abort()
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true })
      try {
        if (controller.signal.aborted) throw new DOMException('Source navigation cancelled', 'AbortError')
        const query = readLatexSyncQuery(input)
        if (query.operationKey !== proof.operationKey || query.snapshotHash !== proof.snapshotHash || query.pdfHash !== proof.pdf.sha256) return { available: false, candidates: [], reason: 'This selection belongs to a different compiled proof.' }
        if (proof.runtime === 'browser') {
          if (!artifact || artifact.identity !== proofActionIdentity(proof)) return { available: false, candidates: [], reason: 'This browser proof has no current session source map. Compile again to create one.' }
          return await local.query(proof, artifact, query, controller.signal)
        }
        // A local failure must never upload source or fall back to native SyncTeX.
        local.dispose()
        if (!proof.syncAvailable) return { available: false, candidates: [], reason: 'The private native source map is unavailable or expired.' }
        const result = await (dependencies.syncNative ?? syncLatexProof)(query, controller.signal)
        if (controller.signal.aborted) throw new DOMException('Source navigation cancelled', 'AbortError')
        const file = result.file ?? (query.direction === 'forward' ? query.file : undefined), line = result.line ?? (query.direction === 'forward' ? query.line : undefined)
        if (!result.available || !file || !line) return { available: false, candidates: [], reason: 'No source location is mapped at this point.' }
        return { available: true, candidates: [{ file, line, locations: result.locations }] }
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new DOMException('Source navigation cancelled', 'AbortError')
        return { available: false, candidates: [], reason: error instanceof Error ? error.message.slice(0, 512) : 'Source navigation is unavailable for this proof.' }
      } finally { signal?.removeEventListener('abort', abort); if (active === controller) active = undefined }
    },
  }
}
