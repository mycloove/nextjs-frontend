import { openSynctex } from './synctexParser.ts'
import type { BrowserSyncArtifact } from './browserSynctex.ts'
import type { LatexSyncQuery } from './types.ts'

const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage: (value: unknown) => void }
type Request = { id: number; identity: string; artifact?: BrowserSyncArtifact; pdf?: ArrayBuffer; query: LatexSyncQuery | null }
let parsed: Awaited<ReturnType<typeof openSynctex>> | undefined, identity: string | undefined, busy = false
scope.onmessage = async ({ data }) => {
  if (busy) return
  busy = true
  try {
    if (!parsed) {
      if (!data.artifact || !data.pdf || data.artifact.identity !== data.identity) throw new Error('The local source map initialization is invalid.')
      parsed = await openSynctex(data.artifact, data.pdf); identity = data.identity
    }
    if (data.identity !== identity) throw new Error('The source map belongs to a different proof.')
    scope.postMessage({ id: data.id, identity, ok: true, result: data.query ? parsed.query(data.query) : { available: true, candidates: [] } })
  } catch (error) {
    parsed?.close(); parsed = undefined
    scope.postMessage({ id: data.id, identity: data.identity, ok: false, error: error instanceof Error ? error.message.slice(0, 512) : 'The bounded local SyncTeX map is unavailable.' })
  } finally { busy = false }
}
