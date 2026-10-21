import { getPrisma, appendAdminAudit, UsageStoreMissing, type AdminAuditContext } from '@/lib/usage/store'
import { Prisma } from '@prisma/client'
import { AI_FEATURES, isAiDriver, isAiFeature } from './catalog.ts'
import { AiConfigError, last4Of, prefixOf } from './crypto.ts'
import { decodeProviderSecret, encodeProviderSecret, getDataKey, type KeyringPrisma } from './keyring.ts'
import { ensureAiCatalog, type AiPrismaLike } from './resolve.ts'
import type { AiDriver, AiFeature, FeatureChainView, KeyView, ProviderView } from './types.ts'

type Tx = Prisma.TransactionClient

/**
 * Bench CRUD for AI providers, keys and feature chains.
 *
 * Mirrors the usage store's conventions: a shared `getPrisma()` singleton, one
 * transaction per write with audit, and writes that throw (an operator must know
 * a save failed) while hot-path bookkeeping never throws.
 *
 * No function here ever returns, logs, or audits a plaintext key: views carry a
 * `…last4` mask only, and the audit rows record the mask.
 */

const KEY_SLUG = /^[a-z0-9][a-z0-9_-]{1,40}$/

type ProviderRow = {
  id: string
  key: string
  label: string
  driver: string
  baseUrl: string | null
  chatModel: string | null
  embeddingModel: string | null
  embeddingDim: number | null
  enabled: boolean
  isCustom: boolean
  sortOrder: number
  keys: KeyRow[]
  routes: { feature: string; priority: number; enabled: boolean }[]
}

type KeyRow = {
  id: string
  providerId: string
  label: string | null
  last4: string | null
  prefix: string | null
  enabled: boolean
  lastError: string | null
  lastUsedAt: Date | null
  cooldownUntil: Date | null
  createdAt: Date
}

function asAiDriver(value: unknown): AiDriver {
  return isAiDriver(value) ? value : 'openai_compatible'
}

function asAiFeature(value: string): AiFeature {
  return isAiFeature(value) ? value : 'document_ai_chat'
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function toKeyView(row: KeyRow): KeyView {
  const masked = row.prefix && row.last4 ? `${row.prefix}…${row.last4}` : row.last4 ? `…${row.last4}` : '…'
  return {
    id: row.id,
    provider_id: row.providerId,
    label: row.label,
    masked,
    last4: row.last4,
    enabled: row.enabled,
    last_error: row.lastError,
    last_used_at: iso(row.lastUsedAt),
    cooldown_until: iso(row.cooldownUntil),
    created_at: row.createdAt.toISOString(),
  }
}

function toProviderView(row: ProviderRow): ProviderView {
  const routes = (row.routes ?? [])
    .filter((route) => isAiFeature(route.feature))
    .map((route) => ({ feature: asAiFeature(route.feature), priority: route.priority, enabled: route.enabled }))
    .sort((a, b) => a.priority - b.priority)
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    driver: asAiDriver(row.driver),
    base_url: row.baseUrl,
    chat_model: row.chatModel,
    embedding_model: row.embeddingModel,
    embedding_dim: row.embeddingDim,
    enabled: row.enabled,
    is_custom: row.isCustom,
    sort_order: row.sortOrder,
    keys: (row.keys ?? []).map(toKeyView),
    routes,
    usable_chat: row.enabled && Boolean(row.chatModel) && Boolean(row.baseUrl),
    usable_embedding: row.enabled && Boolean(row.embeddingModel) && Boolean(row.baseUrl),
  }
}

const AI_DELEGATES = ['aiProvider', 'aiProviderKey', 'aiFeatureRoute'] as const

/**
 * A long-running `next dev` process keeps the `@prisma/client` it first
 * `require`d in the module cache. If the AI models were added to the schema and
 * the client regenerated after that process started, the cached client has no
 * `aiProvider` delegate and the first bench write dies with the opaque
 * `Cannot read properties of undefined (reading 'create')`. Detect that stale
 * client here and answer with the one instruction that actually fixes it,
 * instead of leaking the internal TypeError to the operator.
 */
function requireAiDelegates(prisma: NonNullable<ReturnType<typeof getPrisma>>) {
  const client = prisma as unknown as Record<string, unknown>
  for (const delegate of AI_DELEGATES) {
    if (!client[delegate]) {
      throw new UsageStoreMissing(
        `The Prisma client in this process has no \`${delegate}\` model, so it predates the AI migration. Run \`npm run db:generate\` and restart the dev server.`,
      )
    }
  }
  return prisma
}

function requirePrisma() {
  const prisma = getPrisma()
  if (!prisma) {
    throw new UsageStoreMissing('DATABASE_URL is not set. Configure the store before managing AI providers.')
  }
  return requireAiDelegates(prisma)
}

const PROVIDER_INCLUDE = { keys: { orderBy: { createdAt: 'asc' as const } }, routes: true }

/**
 * Encrypts a secret and inserts its key row, then writes the `ai.key.add` audit.
 * Shared by "add a key" and "create a provider with a key" so the two paths can
 * never diverge on encryption, masking, or audit. Runs inside the caller's
 * transaction: a key that cannot be encrypted rolls the whole write back, so a
 * provider is never left on the bench without the key it was created with.
 */
async function createKeyRow(
  tx: Tx,
  provider: { id: string; key: string },
  secret: string,
  label: string | null | undefined,
  audit?: AdminAuditContext,
): Promise<KeyRow> {
  const ciphertext = encodeProviderSecret(secret)
  const last4 = last4Of(secret)
  const prefix = prefixOf(secret) || null
  const row = (await tx.aiProviderKey.create({
    data: {
      providerId: provider.id,
      ciphertext,
      last4,
      prefix,
      label: label?.trim() || null,
    },
  })) as unknown as KeyRow
  if (audit) {
    await appendAdminAudit(tx, audit, {
      action: 'ai.key.add',
      targetType: 'ai-key',
      targetId: row.id,
      after: { provider_id: provider.id, provider_key: provider.key, last4 },
    })
  }
  return row
}

/** Seeds the catalog on first read, then returns every provider with masked keys. */
export async function listAiProviderViews(): Promise<ProviderView[]> {
  const prisma = requirePrisma()
  await ensureAiCatalog(prisma as unknown as AiPrismaLike)
  const rows = (await prisma.aiProvider.findMany({
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    include: PROVIDER_INCLUDE,
  })) as unknown as ProviderRow[]
  return rows.map(toProviderView)
}

/** The ordered provider ids for each feature, derived from the routes. */
export function featureChains(providers: ProviderView[]): FeatureChainView[] {
  return AI_FEATURES.map((feature) => ({
    feature,
    provider_ids: providers
      .filter((provider) => provider.routes.some((route) => route.feature === feature && route.enabled))
      .sort((a, b) => {
        const pa = a.routes.find((route) => route.feature === feature)?.priority ?? 0
        const pb = b.routes.find((route) => route.feature === feature)?.priority ?? 0
        return pa - pb
      })
      .map((provider) => provider.id),
  }))
}

export async function createAiProvider(
  input: {
    key: string
    label: string
    driver: AiDriver
    baseUrl?: string | null
    chatModel?: string | null
    embeddingModel?: string | null
    embeddingDim?: number | null
    sortOrder?: number
    /** Optional: save the provider and its first key in one transaction. */
    apiKey?: string | null
    keyLabel?: string | null
  },
  audit?: AdminAuditContext,
): Promise<ProviderView> {
  const prisma = requirePrisma()
  const slug = input.key.trim().toLowerCase()
  if (!KEY_SLUG.test(slug)) {
    throw new AiConfigError('The provider id must be a short lowercase slug (letters, digits, dash, underscore).', 400)
  }
  if (!input.label.trim()) throw new AiConfigError('A provider label is required.', 400)
  if (!isAiDriver(input.driver)) throw new AiConfigError('Unknown driver.', 400)

  const secret = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''

  // Resolve the data key before the transaction opens: encrypting inside the tx
  // must not trigger a nested read.
  if (secret) await getDataKey(prisma as unknown as KeyringPrisma)

  try {
    return await prisma.$transaction(async (tx) => {
      let row = (await tx.aiProvider.create({
        data: {
          key: slug,
          label: input.label.trim(),
          driver: input.driver,
          baseUrl: input.baseUrl?.trim() || null,
          chatModel: input.chatModel?.trim() || null,
          embeddingModel: input.embeddingModel?.trim() || null,
          embeddingDim: Number.isFinite(input.embeddingDim) ? Math.trunc(input.embeddingDim as number) : null,
          sortOrder: Number.isFinite(input.sortOrder) ? Math.trunc(input.sortOrder as number) : 100,
          enabled: true,
          isCustom: true,
        },
        include: PROVIDER_INCLUDE,
      })) as unknown as ProviderRow
      if (audit) {
        await appendAdminAudit(tx, audit, {
          action: 'ai.provider.create',
          targetType: 'ai-provider',
          targetId: row.id,
          after: { key: row.key, label: row.label, driver: row.driver, base_url: row.baseUrl },
        })
      }
      if (secret) {
        // The create above ran before the key existed, so its `keys` are empty.
        // Re-read the row through the same transaction so the returned view
        // carries the new `…last4` mask.
        await createKeyRow(tx, row, secret, input.keyLabel ?? null, audit)
        row = (await tx.aiProvider.findUnique({ where: { id: row.id }, include: PROVIDER_INCLUDE })) as unknown as ProviderRow
      }
      return toProviderView(row)
    })
  } catch (error) {
    if (error instanceof AiConfigError) throw error
    if (error instanceof Error && /Unique constraint|unique constraint/i.test(error.message)) {
      throw new AiConfigError('A provider already uses that id.', 409)
    }
    throw error
  }
}

export async function updateAiProvider(
  id: string,
  fields: Partial<{
    label: string
    enabled: boolean
    baseUrl: string | null
    chatModel: string | null
    embeddingModel: string | null
    embeddingDim: number | null
    sortOrder: number
  }>,
  audit?: AdminAuditContext,
): Promise<ProviderView> {
  const prisma = requirePrisma()
  return prisma.$transaction(async (tx) => {
    const before = (await tx.aiProvider.findUnique({ where: { id }, include: PROVIDER_INCLUDE })) as unknown as ProviderRow | null
    if (!before) throw new AiConfigError('That provider is no longer on the bench. Refresh and try again.', 404)

    const data: Record<string, unknown> = {}
    if (typeof fields.label === 'string' && fields.label.trim()) data.label = fields.label.trim()
    if (typeof fields.enabled === 'boolean') data.enabled = fields.enabled
    if (fields.baseUrl !== undefined) data.baseUrl = fields.baseUrl?.trim() || null
    if (fields.chatModel !== undefined) data.chatModel = fields.chatModel?.trim() || null
    if (fields.embeddingModel !== undefined) data.embeddingModel = fields.embeddingModel?.trim() || null
    if (fields.embeddingDim !== undefined) {
      data.embeddingDim = Number.isFinite(fields.embeddingDim) ? Math.trunc(fields.embeddingDim as number) : null
    }
    if (fields.sortOrder !== undefined && Number.isFinite(fields.sortOrder)) data.sortOrder = Math.trunc(fields.sortOrder as number)
    if (!Object.keys(data).length) throw new AiConfigError('Nothing to save.', 400)

    const row = (await tx.aiProvider.update({ where: { id }, data, include: PROVIDER_INCLUDE })) as unknown as ProviderRow
    if (audit) {
      await appendAdminAudit(tx, audit, {
        action: 'ai.provider.update',
        targetType: 'ai-provider',
        targetId: id,
        before: { label: before.label, enabled: before.enabled, base_url: before.baseUrl, chat_model: before.chatModel, embedding_model: before.embeddingModel },
        after: { label: row.label, enabled: row.enabled, base_url: row.baseUrl, chat_model: row.chatModel, embedding_model: row.embeddingModel },
      })
    }
    return toProviderView(row)
  })
}

export async function deleteAiProvider(id: string, force: boolean, audit?: AdminAuditContext): Promise<void> {
  const prisma = requirePrisma()
  await prisma.$transaction(async (tx) => {
    const before = (await tx.aiProvider.findUnique({ where: { id }, include: { routes: true } })) as unknown as (ProviderRow & { routes: unknown[] }) | null
    if (!before) throw new AiConfigError('That provider is no longer on the bench. Refresh and try again.', 404)
    if (!before.isCustom && !force) {
      throw new AiConfigError('Seeded providers cannot be removed. Turn it off instead, or pass ?force=true if you are sure.', 400)
    }
    const routed = (before.routes ?? []).length > 0
    if (routed && !force) {
      throw new AiConfigError('This provider is still used by a feature chain. Remove it from the chains first, or pass ?force=true.', 400)
    }
    await tx.aiProvider.delete({ where: { id } })
    if (audit) {
      await appendAdminAudit(tx, audit, {
        action: 'ai.provider.delete',
        targetType: 'ai-provider',
        targetId: id,
        before: { key: before.key, label: before.label, forced: force },
      })
    }
  })
}

export async function addAiProviderKey(
  input: { providerId: string; secret: string; label?: string | null },
  audit?: AdminAuditContext,
): Promise<KeyView> {
  const prisma = requirePrisma()
  await getDataKey(prisma as unknown as KeyringPrisma)
  return prisma.$transaction(async (tx) => {
    const provider = await tx.aiProvider.findUnique({ where: { id: input.providerId }, select: { id: true, key: true } })
    if (!provider) throw new AiConfigError('That provider is no longer on the bench. Refresh and try again.', 404)
    const row = await createKeyRow(tx, provider, input.secret, input.label, audit)
    return toKeyView(row)
  })
}

export async function rotateAiProviderKey(keyId: string, secret: string, audit?: AdminAuditContext): Promise<KeyView> {
  const prisma = requirePrisma()
  await getDataKey(prisma as unknown as KeyringPrisma)
  const ciphertext = encodeProviderSecret(secret)
  const last4 = last4Of(secret)
  const prefix = prefixOf(secret) || null
  return prisma.$transaction(async (tx) => {
    const before = (await tx.aiProviderKey.findUnique({ where: { id: keyId } })) as unknown as KeyRow | null
    if (!before) throw new AiConfigError('That key is no longer on the bench. Refresh and try again.', 404)
    const row = (await tx.aiProviderKey.update({
      where: { id: keyId },
      data: { ciphertext, last4, prefix, lastError: null, cooldownUntil: null },
    })) as unknown as KeyRow
    if (audit) {
      await appendAdminAudit(tx, audit, {
        action: 'ai.key.rotate',
        targetType: 'ai-key',
        targetId: keyId,
        before: { last4: before.last4 },
        after: { last4 },
      })
    }
    return toKeyView(row)
  })
}

export async function updateAiProviderKey(
  keyId: string,
  fields: { enabled?: boolean; label?: string | null; clearCooldown?: boolean },
  audit?: AdminAuditContext,
): Promise<KeyView> {
  const prisma = requirePrisma()
  return prisma.$transaction(async (tx) => {
    const before = (await tx.aiProviderKey.findUnique({ where: { id: keyId } })) as unknown as KeyRow | null
    if (!before) throw new AiConfigError('That key is no longer on the bench. Refresh and try again.', 404)
    const data: Record<string, unknown> = {}
    if (typeof fields.enabled === 'boolean') data.enabled = fields.enabled
    if (fields.label !== undefined) data.label = fields.label?.trim() || null
    if (fields.clearCooldown) {
      data.cooldownUntil = null
      data.lastError = null
    }
    if (!Object.keys(data).length) throw new AiConfigError('Nothing to save.', 400)
    const row = (await tx.aiProviderKey.update({ where: { id: keyId }, data })) as unknown as KeyRow
    if (audit) {
      await appendAdminAudit(tx, audit, {
        action: 'ai.key.update',
        targetType: 'ai-key',
        targetId: keyId,
        before: { enabled: before.enabled, label: before.label },
        after: { enabled: row.enabled, label: row.label },
      })
    }
    return toKeyView(row)
  })
}

export async function deleteAiProviderKey(keyId: string, audit?: AdminAuditContext): Promise<void> {
  const prisma = requirePrisma()
  await prisma.$transaction(async (tx) => {
    const before = (await tx.aiProviderKey.findUnique({ where: { id: keyId } })) as unknown as KeyRow | null
    if (!before) throw new AiConfigError('That key is no longer on the bench. Refresh and try again.', 404)
    await tx.aiProviderKey.delete({ where: { id: keyId } })
    if (audit) {
      await appendAdminAudit(tx, audit, {
        action: 'ai.key.delete',
        targetType: 'ai-key',
        targetId: keyId,
        before: { provider_id: before.providerId, last4: before.last4 },
      })
    }
  })
}

/**
 * Replaces the whole chain for one feature. The embedding feature accepts a
 * single provider because an index has exactly one vector width; anything else
 * would index with one model and query with another.
 */
export async function setFeatureChain(feature: AiFeature, providerIds: string[], audit?: AdminAuditContext): Promise<ProviderView[]> {
  const prisma = requirePrisma()
  const unique = [...new Set(providerIds.filter((id) => typeof id === 'string' && id.trim()))]
  if (feature === 'document_ai_embedding' && unique.length > 1) {
    throw new AiConfigError('Embeddings use a single provider. Choose one.', 400)
  }
  if (unique.length) {
    const found = await prisma.aiProvider.count({ where: { id: { in: unique } } })
    if (found !== unique.length) throw new AiConfigError('One of those providers is no longer on the bench.', 400)
  }

  await prisma.$transaction(async (tx) => {
    const before = await tx.aiFeatureRoute.findMany({ where: { feature } })
    await tx.aiFeatureRoute.deleteMany({ where: { feature } })
    if (unique.length) {
      await tx.aiFeatureRoute.createMany({
        data: unique.map((providerId, index) => ({ feature, providerId, priority: index, enabled: true })),
      })
    }
    if (audit) {
      await appendAdminAudit(tx, audit, {
        action: 'ai.route.set',
        targetType: 'ai-route',
        targetId: feature,
        before: { provider_ids: before.map((row) => row.providerId) },
        after: { provider_ids: unique },
      })
    }
  })

  return listAiProviderViews()
}

/** Masked keys, optionally for a single provider. Never returns a ciphertext. */
export async function listAiKeyViews(providerId?: string | null): Promise<KeyView[]> {
  const prisma = requirePrisma()
  const rows = (await prisma.aiProviderKey.findMany({
    where: providerId ? { providerId } : undefined,
    orderBy: [{ createdAt: 'asc' }],
  })) as unknown as KeyRow[]
  return rows.map(toKeyView)
}

/**
 * Loads a provider plus one decrypted key for a server-side probe. The plaintext
 * key exists only in the probe's own stack frame and is never returned.
 */
export async function loadKeyForProbe(
  providerId: string,
  keyId?: string | null,
): Promise<{ provider: ProviderView; apiKey: string }> {
  const prisma = requirePrisma()
  await getDataKey(prisma as unknown as KeyringPrisma)
  const provider = (await prisma.aiProvider.findUnique({ where: { id: providerId }, include: PROVIDER_INCLUDE })) as unknown as ProviderRow | null
  if (!provider) throw new AiConfigError('That provider is no longer on the bench. Refresh and try again.', 404)

  const keyRow = keyId
    ? await prisma.aiProviderKey.findUnique({ where: { id: keyId } })
    : await prisma.aiProviderKey.findFirst({ where: { providerId, enabled: true }, orderBy: { createdAt: 'asc' } })
  if (!keyRow) throw new AiConfigError('Add a key to this provider first.', 400)
  if (keyRow.providerId !== providerId) throw new AiConfigError('That key does not belong to this provider.', 400)

  return { provider: toProviderView(provider), apiKey: decodeProviderSecret(keyRow.ciphertext).plaintext }
}

/**
 * Returns a stored key's plaintext, on an explicit Owner request, and audits the
 * reveal. The desk shows a mask by default; this is the one path that produces a
 * full key, so it is owner-gated and throttled at the route and never logged.
 */
export async function revealAiProviderKey(keyId: string, audit?: AdminAuditContext): Promise<{ id: string; secret: string }> {
  const prisma = requirePrisma()
  await getDataKey(prisma as unknown as KeyringPrisma)
  return prisma.$transaction(async (tx) => {
    const row = await tx.aiProviderKey.findUnique({ where: { id: keyId } })
    if (!row) throw new AiConfigError('That key is no longer on the bench. Refresh and try again.', 404)
    const { plaintext, legacy } = decodeProviderSecret(row.ciphertext)
    if (legacy) {
      // Heal a row written under the old env secret: re-encrypt it under the
      // database's data key so this server and every other one can read it.
      await tx.aiProviderKey.update({ where: { id: keyId }, data: { ciphertext: encodeProviderSecret(plaintext) } })
      if (audit) {
        await appendAdminAudit(tx, audit, {
          action: 'ai.key.reencrypt',
          targetType: 'ai-key',
          targetId: keyId,
          after: { provider_id: row.providerId, last4: row.last4 },
        })
      }
    }
    if (audit) {
      await appendAdminAudit(tx, audit, {
        action: 'ai.key.reveal',
        targetType: 'ai-key',
        targetId: keyId,
        after: { provider_id: row.providerId, last4: row.last4 },
      })
    }
    return { id: keyId, secret: plaintext }
  })
}

const IMPORT_SOURCES: { env: string; providerKey: string }[] = [
  { env: 'GROQ_API_KEY', providerKey: 'groq' },
  { env: 'HF_TOKEN', providerKey: 'huggingface' },
]

/**
 * Seeds provider keys from the legacy environment variables, so an existing
 * deployment can be brought onto the broker without retyping keys. A provider
 * that already has a key is left alone.
 */
export async function importKeysFromEnv(audit?: AdminAuditContext): Promise<{ created: number; providers: string[] }> {
  const prisma = requirePrisma()
  const providers = await prisma.aiProvider.findMany({ include: { keys: true } })
  const byKey = new Map(providers.map((provider) => [provider.key, provider]))
  const created: string[] = []

  for (const source of IMPORT_SOURCES) {
    const secret = process.env[source.env]?.trim()
    if (!secret) continue
    const provider = byKey.get(source.providerKey)
    if (!provider || provider.keys.length > 0) continue
    await addAiProviderKey({ providerId: provider.id, secret, label: `Imported from ${source.env}` }, audit)
    created.push(source.providerKey)
  }
  return { created: created.length, providers: created }
}

/**
 * Records the outcome of one upstream call against its key. Best-effort by
 * design: this runs on the hot path and must never turn a served answer into an
 * error. On success the cooldown and last error are cleared; on failure the
 * error is stored and, when a cooldown is given, the key is parked.
 */
export async function markKeyResult(
  keyId: string,
  result: { ok: boolean; error?: string | null; cooldownMs?: number },
): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  try {
    if (result.ok) {
      await prisma.aiProviderKey.update({
        where: { id: keyId },
        data: { lastUsedAt: new Date(), lastError: null, cooldownUntil: null },
      })
      return
    }
    const cooldownMs = Number.isFinite(result.cooldownMs) ? Math.max(0, result.cooldownMs as number) : 0
    await prisma.aiProviderKey.update({
      where: { id: keyId },
      data: {
        lastUsedAt: new Date(),
        lastError: (result.error ?? 'Provider call failed').slice(0, 300),
        cooldownUntil: cooldownMs > 0 ? new Date(Date.now() + cooldownMs) : null,
      },
    })
  } catch {
    // A health write must never change a served response.
  }
}
