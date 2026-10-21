import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AiConfigError, encryptWithKey } from './crypto.ts'
import {
  DEK_ROW_ID,
  decodeProviderSecret,
  encodeProviderSecret,
  getDataKeyInfo,
  keyringStatus,
  resetKeyring,
  type KeyringPrisma,
  type SecretRow,
} from './keyring.ts'

type Fake = {
  prisma: KeyringPrisma
  rows: Map<string, SecretRow>
  state: { creates: number }
}

function fakePrisma(seed?: SecretRow): Fake {
  const rows = new Map<string, SecretRow>()
  if (seed) rows.set(seed.key, seed)
  const state = { creates: 0 }
  const prisma: KeyringPrisma = {
    systemSecret: {
      findUnique: async ({ where }) => rows.get(where.key) ?? null,
      createMany: async ({ data }) => {
        state.creates += 1
        for (const row of data) {
          if (!rows.has(row.key)) rows.set(row.key, { key: row.key, value: row.value, wrapped: row.wrapped })
        }
        return { count: data.length }
      },
    },
  }
  return { prisma, rows, state }
}

async function withEnv<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.AI_KEY_ENCRYPTION_SECRET
  if (value === undefined) delete process.env.AI_KEY_ENCRYPTION_SECRET
  else process.env.AI_KEY_ENCRYPTION_SECRET = value
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env.AI_KEY_ENCRYPTION_SECRET
    else process.env.AI_KEY_ENCRYPTION_SECRET = previous
  }
}

test('with no KEK it stores a portable, unwrapped data key', async () => {
  await withEnv(undefined, async () => {
    resetKeyring()
    const db = fakePrisma()
    const info = await getDataKeyInfo(db.prisma)
    assert.equal(info.mode, 'unwrapped')
    assert.equal(db.state.creates, 1)
    const row = db.rows.get(DEK_ROW_ID)
    assert.ok(row)
    assert.equal(row?.wrapped, false)
    assert.deepEqual(Buffer.from(row?.value ?? '', 'base64'), info.key)

    const envelope = encodeProviderSecret('sk-live-1234')
    assert.deepEqual(decodeProviderSecret(envelope), { plaintext: 'sk-live-1234', legacy: false })
  })
})

test('with a KEK it adopts the env secret and stores it wrapped', async () => {
  const kek = Buffer.alloc(32, 5)
  await withEnv(kek.toString('base64'), async () => {
    resetKeyring()
    const db = fakePrisma()
    const info = await getDataKeyInfo(db.prisma)
    assert.equal(info.mode, 'kek')
    assert.deepEqual(info.key, kek)
    assert.equal(db.rows.get(DEK_ROW_ID)?.wrapped, true)
    // A row written before the data key existed is still openable, because the
    // data key *is* the env secret.
    const legacyEnvelope = encryptWithKey(kek, 'sk-old-row')
    assert.deepEqual(decodeProviderSecret(legacyEnvelope), { plaintext: 'sk-old-row', legacy: false })
  })
})

test('an unwrapped DEK still opens legacy env-encrypted rows', async () => {
  const kek = Buffer.alloc(32, 6)
  const dek = Buffer.alloc(32, 11)
  await withEnv(kek.toString('base64'), async () => {
    resetKeyring()
    const db = fakePrisma({ key: DEK_ROW_ID, value: dek.toString('base64'), wrapped: false })
    const info = await getDataKeyInfo(db.prisma)
    assert.deepEqual(info.key, dek)
    const legacyEnvelope = encryptWithKey(kek, 'sk-legacy')
    assert.deepEqual(decodeProviderSecret(legacyEnvelope), { plaintext: 'sk-legacy', legacy: true })
  })
})

test('an unwrapped DEK cannot open a legacy row once the env secret is gone', async () => {
  const kek = Buffer.alloc(32, 6)
  const dek = Buffer.alloc(32, 11)
  await withEnv(undefined, async () => {
    resetKeyring()
    const db = fakePrisma({ key: DEK_ROW_ID, value: dek.toString('base64'), wrapped: false })
    await getDataKeyInfo(db.prisma)
    const legacyEnvelope = encryptWithKey(kek, 'sk-legacy')
    assert.throws(() => decodeProviderSecret(legacyEnvelope))
  })
})

test('a wrapped DEK with no env secret is locked', async () => {
  const kek = Buffer.alloc(32, 7)
  const dek = Buffer.alloc(32, 12)
  const value = encryptWithKey(kek, dek.toString('base64'))
  await withEnv(undefined, async () => {
    resetKeyring()
    const db = fakePrisma({ key: DEK_ROW_ID, value, wrapped: true })
    await assert.rejects(
      () => getDataKeyInfo(db.prisma),
      (error: unknown) => error instanceof AiConfigError && error.status === 503,
    )
    const status = await keyringStatus(db.prisma)
    assert.equal(status.ready, false)
    assert.equal(status.locked, true)
  })
})

test('a wrapped DEK with the wrong env secret is a mismatch (409)', async () => {
  const kek = Buffer.alloc(32, 7)
  const wrong = Buffer.alloc(32, 8)
  const dek = Buffer.alloc(32, 12)
  const value = encryptWithKey(kek, dek.toString('base64'))
  await withEnv(wrong.toString('base64'), async () => {
    resetKeyring()
    const db = fakePrisma({ key: DEK_ROW_ID, value, wrapped: true })
    await assert.rejects(
      () => getDataKeyInfo(db.prisma),
      (error: unknown) => error instanceof AiConfigError && error.status === 409,
    )
    const status = await keyringStatus(db.prisma)
    assert.equal(status.ready, false)
    assert.equal(status.locked, true)
  })
})

test('concurrent cold starts create the data key exactly once', async () => {
  await withEnv(undefined, async () => {
    resetKeyring()
    const db = fakePrisma()
    const [a, b] = await Promise.all([getDataKeyInfo(db.prisma), getDataKeyInfo(db.prisma)])
    assert.deepEqual(a.key, b.key)
    assert.equal(db.state.creates, 1)
  })
})
