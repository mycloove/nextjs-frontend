import type { DiagramBlock, DiagramRenderResult } from './types'

const MAX_CACHE_ENTRIES = 64
const MAX_CACHE_BYTES = 12 * 1024 * 1024
const MAX_CONCURRENT_RENDERS = 3
const RENDER_TIMEOUT_MS = 25_000

type CacheEntry = { result: DiagramRenderResult; size: number }

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<DiagramRenderResult>>()
const waiters: Array<() => void> = []
let cacheBytes = 0
let activeRenders = 0

function renderKey(block: DiagramBlock, theme: 'light' | 'dark'): string {
  return `${block.engine}\u0000${block.language}\u0000${theme}\u0000${block.source}\u0000${JSON.stringify(block.attributes)}`
}

function readCache(key: string): DiagramRenderResult | null {
  const entry = cache.get(key)
  if (!entry) return null
  cache.delete(key)
  cache.set(key, entry)
  return entry.result
}

function writeCache(key: string, result: DiagramRenderResult): void {
  const size = result.content.length * 2
  if (size > MAX_CACHE_BYTES / 2) return

  const previous = cache.get(key)
  if (previous) cacheBytes -= previous.size
  cache.delete(key)
  cache.set(key, { result, size })
  cacheBytes += size

  while (cache.size > MAX_CACHE_ENTRIES || cacheBytes > MAX_CACHE_BYTES) {
    const oldestKey = cache.keys().next().value as string | undefined
    if (!oldestKey) break
    const oldest = cache.get(oldestKey)
    cache.delete(oldestKey)
    cacheBytes -= oldest?.size ?? 0
  }
}

async function acquireSlot(): Promise<void> {
  if (activeRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders += 1
    return
  }
  await new Promise<void>((resolve) => waiters.push(resolve))
  activeRenders += 1
}

function releaseSlot(): void {
  activeRenders = Math.max(0, activeRenders - 1)
  waiters.shift()?.()
}

function waitForCaller<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Diagram rendering was cancelled.', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Diagram rendering was cancelled.', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

async function createRender(block: DiagramBlock, theme: 'light' | 'dark'): Promise<DiagramRenderResult> {
  await acquireSlot()
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS)
  try {
    const { renderDiagram } = await import('./renderers')
    return await renderDiagram(block, { theme, signal: controller.signal })
  } finally {
    window.clearTimeout(timeout)
    releaseSlot()
  }
}

export async function renderDiagramCached(
  block: DiagramBlock,
  theme: 'light' | 'dark',
  signal: AbortSignal,
  force = false,
): Promise<DiagramRenderResult> {
  const key = renderKey(block, theme)
  if (force) cache.delete(key)
  const cached = readCache(key)
  if (cached) return cached

  let pending = inFlight.get(key)
  if (!pending) {
    pending = createRender(block, theme)
      .then((result) => {
        writeCache(key, result)
        return result
      })
      .finally(() => inFlight.delete(key))
    inFlight.set(key, pending)
  }
  return waitForCaller(pending, signal)
}
