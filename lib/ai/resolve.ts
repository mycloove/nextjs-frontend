import { AI_PROVIDER_CATALOG, AI_ROUTE_DEFAULTS } from './catalog.ts'
import type { AiChainAttempt, AiDriver, AiFeature } from './types.ts'

/**
 * Ordered provider chains, resolved against the store.
 *
 * Kept free of any Prisma import so it can be unit-tested with a plain fake, and
 * so a caller can cast the real client to `AiPrismaLike` in one place. Decryption
 * is injected as `decode`, which the broker backs with the cached data key, so
 * this module never reads the environment or a secret itself. Every failure path
 * degrades to an empty chain, which the broker reads as "use the legacy env
 * path" — the rollback story.
 */

/** Decrypts a stored key envelope. Throws when the row cannot be opened. */
export type DecodeSecret = (ciphertext: string) => string

export type AiKeyRow = {
  id: string
  enabled: boolean
  ciphertext: string
  cooldownUntil: Date | string | null
  lastUsedAt: Date | string | null
}

export type AiProviderRow = {
  id: string
  key: string
  label: string
  driver: string
  baseUrl: string | null
  chatModel: string | null
  embeddingModel: string | null
  embeddingDim: number | null
  enabled: boolean
  keys: AiKeyRow[]
}

export type AiRouteRow = { provider: AiProviderRow | null }

export type AiPrismaLike = {
  aiProvider: {
    createMany: (args: { data: Record<string, unknown>[]; skipDuplicates?: boolean }) => Promise<{ count: number }>
    findMany: (args?: Record<string, unknown>) => Promise<AiProviderRow[]>
    count: (args?: Record<string, unknown>) => Promise<number>
  }
  aiFeatureRoute: {
    createMany: (args: { data: Record<string, unknown>[]; skipDuplicates?: boolean }) => Promise<{ count: number }>
    findMany: (args?: Record<string, unknown>) => Promise<AiRouteRow[]>
    count: (args?: Record<string, unknown>) => Promise<number>
  }
}

const EMBEDDING_FEATURE: AiFeature = 'document_ai_embedding'

/**
 * Seeds the six providers and, on a brand-new store only, the default chains.
 *
 * Routes are seeded once, when the table is empty. After that they are entirely
 * the operator's: an intentionally cleared chain must not be silently refilled
 * on the next page load.
 */
export async function ensureAiCatalog(prisma: AiPrismaLike): Promise<void> {
  await prisma.aiProvider.createMany({
    data: AI_PROVIDER_CATALOG.map((provider) => ({
      key: provider.key,
      label: provider.label,
      driver: provider.driver,
      baseUrl: provider.baseUrl,
      chatModel: provider.chatModel,
      embeddingModel: provider.embeddingModel,
      embeddingDim: provider.embeddingDim,
      sortOrder: provider.sortOrder,
      enabled: true,
      isCustom: false,
      updatedAt: new Date(),
    })),
    skipDuplicates: true,
  })

  if ((await prisma.aiFeatureRoute.count()) > 0) return

  const providers = await prisma.aiProvider.findMany({ select: { id: true, key: true } })
  const byKey = new Map(providers.map((provider) => [provider.key, provider.id]))
  const rows = AI_ROUTE_DEFAULTS.flatMap((group) =>
    group.providerKeys.flatMap((key, index) => {
      const providerId = byKey.get(key)
      return providerId
        ? [{ feature: group.feature, providerId, priority: index, enabled: true, updatedAt: new Date() }]
        : []
    }),
  )
  if (rows.length) await prisma.aiFeatureRoute.createMany({ data: rows, skipDuplicates: true })
}

function timeOf(value: Date | string | null): number {
  if (!value) return 0
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function modelFor(feature: AiFeature, provider: AiProviderRow): string | null {
  return feature === EMBEDDING_FEATURE ? provider.embeddingModel : provider.chatModel
}

/**
 * The ordered candidates for one feature: each enabled route whose provider is
 * enabled, is configured with a model and base URL, and has an enabled key that
 * is not cooling down. One key per provider is chosen — the least recently used
 * — so a pool spreads free-tier load. Embeddings are capped to a single
 * candidate: the index has one vector width, so there is no cross-provider
 * fallback for them.
 */
export async function resolveChain(prisma: AiPrismaLike, feature: AiFeature, decode: DecodeSecret): Promise<AiChainAttempt[]> {
  let routes: AiRouteRow[]
  try {
    routes = await prisma.aiFeatureRoute.findMany({
      where: { feature, enabled: true, provider: { enabled: true } },
      orderBy: [{ priority: 'asc' }, { updatedAt: 'asc' }],
      include: { provider: { include: { keys: { where: { enabled: true } } } } },
    })
  } catch {
    return []
  }

  const now = Date.now()
  const attempts: AiChainAttempt[] = []

  for (const route of routes) {
    const provider = route.provider
    if (!provider || !provider.enabled) continue
    const model = modelFor(feature, provider)
    const baseUrl = typeof provider.baseUrl === 'string' ? provider.baseUrl.trim() : ''
    if (!model || !baseUrl) continue

    const usable = [...(provider.keys ?? [])]
      .filter((key) => key.enabled)
      .filter((key) => !key.cooldownUntil || timeOf(key.cooldownUntil) <= now)
      .sort((a, b) => timeOf(a.lastUsedAt) - timeOf(b.lastUsedAt))

    let chosen: { id: string; apiKey: string } | null = null
    for (const key of usable) {
      try {
        const apiKey = decode(key.ciphertext)
        if (apiKey) {
          chosen = { id: key.id, apiKey }
          break
        }
      } catch {
        // Unreadable row or unloaded data key: skip this key. If no key anywhere
        // decrypts, the chain is empty and the caller uses legacy.
        continue
      }
    }
    if (!chosen) continue

    attempts.push({
      feature,
      providerId: provider.id,
      providerKey: provider.key,
      label: provider.label,
      driver: provider.driver as AiDriver,
      baseUrl,
      model,
      dim: provider.embeddingDim ?? null,
      apiKey: chosen.apiKey,
      keyId: chosen.id,
    })

    if (feature === EMBEDDING_FEATURE) break
  }

  return attempts
}
