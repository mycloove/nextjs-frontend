import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ensureAiCatalog, resolveChain, type AiPrismaLike } from './resolve.ts'

/**
 * Stands in for the keyring decoder: identity except for the sentinel that
 * models a row the data key cannot open.
 */
function decode(ciphertext: string): string {
  if (ciphertext === 'not-an-envelope') throw new Error('unreadable')
  return ciphertext
}

type ProviderSeed = {
  id: string
  key: string
  enabled?: boolean
  chatModel?: string | null
  embeddingModel?: string | null
  baseUrl?: string | null
  keys?: { id: string; enabled?: boolean; cooldownUntil?: Date | null; lastUsedAt?: Date | null; ciphertext?: string }[]
}

function providerRow(seed: ProviderSeed) {
  return {
    id: seed.id,
    key: seed.key,
    label: seed.key,
    driver: 'openai_compatible',
    baseUrl: seed.baseUrl === undefined ? 'https://example.test/v1' : seed.baseUrl,
    chatModel: seed.chatModel === undefined ? 'chat-model' : seed.chatModel,
    embeddingModel: seed.embeddingModel === undefined ? 'embed-model' : seed.embeddingModel,
    embeddingDim: 768,
    enabled: seed.enabled ?? true,
    keys: (seed.keys ?? []).map((key) => ({
      id: key.id,
      enabled: key.enabled ?? true,
      ciphertext: key.ciphertext ?? `secret-${key.id}`,
      cooldownUntil: key.cooldownUntil ?? null,
      lastUsedAt: key.lastUsedAt ?? null,
    })),
  }
}

function prismaWith(rows: { provider: unknown }[]): AiPrismaLike {
  return {
    aiProvider: {
      createMany: async () => ({ count: 0 }),
      findMany: async () => [],
      count: async () => rows.length,
    },
    aiFeatureRoute: {
      createMany: async () => ({ count: 0 }),
      findMany: async () => rows as never,
      count: async () => rows.length,
    },
  }
}

test('a chain keeps the route order', async () => {
  const prisma = prismaWith([
    { provider: providerRow({ id: 'a', key: 'a', keys: [{ id: 'k-a' }] }) },
    { provider: providerRow({ id: 'b', key: 'b', keys: [{ id: 'k-b' }] }) },
  ])
  const chain = await resolveChain(prisma, 'document_ai_chat', decode)
  assert.deepEqual(chain.map((attempt) => attempt.providerId), ['a', 'b'])
  assert.equal(chain[0].apiKey, 'secret-k-a')
})

test('a disabled provider is skipped', async () => {
  const prisma = prismaWith([
    { provider: providerRow({ id: 'a', key: 'a', enabled: false, keys: [{ id: 'k-a' }] }) },
    { provider: providerRow({ id: 'b', key: 'b', keys: [{ id: 'k-b' }] }) },
  ])
  const chain = await resolveChain(prisma, 'document_ai_chat', decode)
  assert.deepEqual(chain.map((attempt) => attempt.providerId), ['b'])
})

test('a provider whose only key is cooling down is skipped', async () => {
  const prisma = prismaWith([
    { provider: providerRow({ id: 'a', key: 'a', keys: [{ id: 'k-a', cooldownUntil: new Date(Date.now() + 60_000) }] }) },
    { provider: providerRow({ id: 'b', key: 'b', keys: [{ id: 'k-b', cooldownUntil: new Date(Date.now() - 60_000) }] }) },
  ])
  const chain = await resolveChain(prisma, 'document_ai_chat', decode)
  assert.deepEqual(chain.map((attempt) => attempt.providerId), ['b'])
})

test('the least recently used key is chosen from a pool', async () => {
  const prisma = prismaWith([
    {
      provider: providerRow({
        id: 'a',
        key: 'a',
        keys: [
          { id: 'old', lastUsedAt: new Date(Date.now() - 10_000) },
          { id: 'fresh', lastUsedAt: new Date(Date.now() - 1_000) },
        ],
      }),
    },
  ])
  const chain = await resolveChain(prisma, 'document_ai_chat', decode)
  assert.equal(chain[0].keyId, 'old')
})

test('embedding chains are capped to a single provider', async () => {
  const prisma = prismaWith([
    { provider: providerRow({ id: 'a', key: 'a', keys: [{ id: 'k-a' }] }) },
    { provider: providerRow({ id: 'b', key: 'b', keys: [{ id: 'k-b' }] }) },
  ])
  const chain = await resolveChain(prisma, 'document_ai_embedding', decode)
  assert.equal(chain.length, 1)
  assert.equal(chain[0].model, 'embed-model')
})

test('a provider with no model is not a candidate', async () => {
  const prisma = prismaWith([{ provider: providerRow({ id: 'a', key: 'a', chatModel: null, keys: [{ id: 'k-a' }] }) }])
  assert.deepEqual(await resolveChain(prisma, 'document_ai_chat', decode), [])
})

test('an unreadable key is skipped rather than throwing', async () => {
  const prisma = prismaWith([
    { provider: providerRow({ id: 'a', key: 'a', keys: [{ id: 'bad', ciphertext: 'not-an-envelope' }] }) },
    { provider: providerRow({ id: 'b', key: 'b', keys: [{ id: 'k-b' }] }) },
  ])
  const chain = await resolveChain(prisma, 'document_ai_chat', decode)
  assert.deepEqual(chain.map((attempt) => attempt.providerId), ['b'])
})

test('a findMany failure degrades to an empty chain', async () => {
  const prisma: AiPrismaLike = {
    aiProvider: { createMany: async () => ({ count: 0 }), findMany: async () => [], count: async () => 0 },
    aiFeatureRoute: {
      createMany: async () => ({ count: 0 }),
      findMany: async () => {
        throw new Error('no tables')
      },
      count: async () => 0,
    },
  }
  assert.deepEqual(await resolveChain(prisma, 'document_ai_chat', decode), [])
})

test('ensureAiCatalog seeds routes only when the table is empty', async () => {
  const created: Record<string, unknown>[] = []
  const providers = [{ id: 'p-google', key: 'google' }, { id: 'p-groq', key: 'groq' }]
  const prisma: AiPrismaLike = {
    aiProvider: {
      createMany: async () => ({ count: 0 }),
      findMany: async () => providers as never,
      count: async () => providers.length,
    },
    aiFeatureRoute: {
      createMany: async (args) => {
        created.push(...args.data)
        return { count: args.data.length }
      },
      findMany: async () => [],
      count: async () => 0,
    },
  }
  await ensureAiCatalog(prisma)
  assert.ok(created.some((row) => row.feature === 'document_ai_embedding' && row.providerId === 'p-google'))
})

test('ensureAiCatalog leaves an existing chain alone', async () => {
  let routeWrites = 0
  const prisma: AiPrismaLike = {
    aiProvider: { createMany: async () => ({ count: 0 }), findMany: async () => [], count: async () => 0 },
    aiFeatureRoute: {
      createMany: async () => {
        routeWrites += 1
        return { count: 0 }
      },
      findMany: async () => [],
      count: async () => 3,
    },
  }
  await ensureAiCatalog(prisma)
  assert.equal(routeWrites, 0)
})
