import type { DiagramEngine, DiagramEngineCapability } from './types'

const CACHE_TTL_MS = 30_000
let cachedAt = 0
let cached = new Map<DiagramEngine, DiagramEngineCapability>()
let pending: Promise<Map<DiagramEngine, DiagramEngineCapability>> | null = null

async function requestCapabilities(): Promise<Map<DiagramEngine, DiagramEngineCapability>> {
  const response = await fetch('/api/diagrams/capabilities', {
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error('Diagram capability discovery is unavailable.')
  const payload = await response.json() as { engines?: DiagramEngineCapability[] }
  const next = new Map<DiagramEngine, DiagramEngineCapability>()
  for (const capability of payload.engines ?? []) next.set(capability.engine, capability)
  cached = next
  cachedAt = Date.now()
  return next
}

export async function getServerCapabilities(force = false): Promise<Map<DiagramEngine, DiagramEngineCapability>> {
  if (force) cachedAt = 0
  if (Date.now() - cachedAt < CACHE_TTL_MS) return cached
  if (!pending) pending = requestCapabilities().finally(() => { pending = null })
  return pending
}

export async function getServerCapability(engine: DiagramEngine): Promise<DiagramEngineCapability | null> {
  return (await getServerCapabilities()).get(engine) ?? null
}

export function invalidateServerCapabilities(): void {
  cachedAt = 0
}