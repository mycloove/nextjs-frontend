import { AiConfigError, decryptWithKey, encryptWithKey, generateKey, parseEnvSecret, KEY_BYTES } from './crypto.ts'
import type { AiKeyMode, KeyringStatus } from './types.ts'

/**
 * The AI provider-key keyring.
 *
 * Provider keys are encrypted under a single data key (DEK). The DEK is stored
 * in the `system_secrets` table so it travels with the data: any server pointed
 * at the same DATABASE_URL can decrypt provider keys, even with no
 * AI_KEY_ENCRYPTION_SECRET. That removes the "Could not reveal the key" failure
 * where the only decryption key was a machine-local `.env` value.
 *
 * Two modes:
 *  - `unwrapped` (default, portable): a random DEK is stored base64 in the DB.
 *  - `kek`: when AI_KEY_ENCRYPTION_SECRET is present at first init it is adopted
 *    as the DEK (so pre-existing rows keep decrypting) and the DEK is stored
 *    wrapped by that same secret.
 *
 * This module never imports Prisma or the alias-based store; the caller passes a
 * minimal delegate so it can be unit-tested with a fake.
 */

export const DEK_ROW_ID = 'ai_key_dek'

export type SecretRow = { key: string; value: string; wrapped: boolean }
export type SecretInsert = SecretRow & { updatedAt: Date }

export type KeyringPrisma = {
  systemSecret: {
    findUnique: (args: { where: { key: string } }) => Promise<SecretRow | null>
    createMany: (args: { data: SecretInsert[]; skipDuplicates?: boolean }) => Promise<{ count: number }>
  }
}

export type DataKeyInfo = { key: Buffer; mode: AiKeyMode }

let cached: DataKeyInfo | null = null
let inflight: Promise<DataKeyInfo> | null = null

/** Test seam: forget the cached data key. */
export function resetKeyring(): void {
  cached = null
  inflight = null
}

function secretDelegate(prisma: KeyringPrisma): KeyringPrisma['systemSecret'] {
  const delegate = (prisma as unknown as { systemSecret?: KeyringPrisma['systemSecret'] })?.systemSecret
  if (!delegate || typeof delegate.findUnique !== 'function' || typeof delegate.createMany !== 'function') {
    throw new AiConfigError(
      'This server\'s Prisma client has no `systemSecret` model, so it predates the system_secrets migration. Run `npm run db:generate` and restart.',
      503,
      'stale_client',
    )
  }
  return delegate
}

function keyBuffer(value: string): Buffer {
  const key = Buffer.from(value, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new AiConfigError('The stored AI data key is corrupt. Re-add the provider keys.', 503, 'dek_corrupt')
  }
  return key
}

function unwrap(row: SecretRow, kek: Buffer | null): DataKeyInfo {
  if (!row.wrapped) return { key: keyBuffer(row.value), mode: 'unwrapped' }
  if (!kek) {
    throw new AiConfigError(
      'Provider keys are locked: the AI data key is wrapped by AI_KEY_ENCRYPTION_SECRET, which is not set on this server. Set the same secret that created the keys, or re-add each provider key.',
      503,
      'kek_required',
    )
  }
  let inner: string
  try {
    inner = decryptWithKey(kek, row.value)
  } catch {
    throw new AiConfigError(
      'Provider keys are locked: AI_KEY_ENCRYPTION_SECRET does not match the secret that wrapped the AI data key. Restore the original secret, or re-add each provider key.',
      409,
      'kek_mismatch',
    )
  }
  return { key: keyBuffer(inner), mode: 'kek' }
}

async function read(prisma: KeyringPrisma): Promise<DataKeyInfo> {
  const delegate = secretDelegate(prisma)
  const existing = await delegate.findUnique({ where: { key: DEK_ROW_ID } })
  if (existing) return unwrap(existing, parseEnvSecret())

  const kek = parseEnvSecret()
  // Adopt the env secret as the DEK so rows written before this change (which
  // were encrypted with it) keep decrypting without re-entry.
  const dek = kek ?? generateKey()
  const value = kek ? encryptWithKey(kek, dek.toString('base64')) : dek.toString('base64')
  await delegate.createMany({
    data: [{ key: DEK_ROW_ID, value, wrapped: Boolean(kek), updatedAt: new Date() }],
    skipDuplicates: true,
  })
  const row = await delegate.findUnique({ where: { key: DEK_ROW_ID } })
  if (!row) throw new AiConfigError('The AI data key could not be stored.', 503)
  return unwrap(row, kek)
}

function asKeyringError(error: unknown): never {
  if (error instanceof AiConfigError) throw error
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'P2021' || code === 'P2022') {
    throw new AiConfigError(
      'The system_secrets table is missing. Run the Prisma migration (`npm run db:migrate`) and restart.',
      503,
      'table_missing',
    )
  }
  throw error
}

function loadOnce(prisma: KeyringPrisma): Promise<DataKeyInfo> {
  if (cached) return Promise.resolve(cached)
  if (inflight) return inflight
  const promise = read(prisma)
    .then((info) => {
      cached = info
      inflight = null
      return info
    })
    .catch((error) => {
      inflight = null
      return asKeyringError(error)
    })
  inflight = promise
  return promise
}

/** Loads (and caches) the data key. Throws AiConfigError when locked/mismatched. */
export async function getDataKeyInfo(prisma: KeyringPrisma): Promise<DataKeyInfo> {
  return loadOnce(prisma)
}

export async function getDataKey(prisma: KeyringPrisma): Promise<Buffer> {
  return (await loadOnce(prisma)).key
}

/**
 * Encrypts a provider secret under the cached data key. Call `getDataKey` (or
 * `getDataKeyInfo`) first: store writes resolve the DEK before their transaction
 * so no DB read happens while the transaction is open.
 */
export function encodeProviderSecret(plain: string): string {
  if (!cached) throw new AiConfigError('The AI data key is not loaded yet.', 503)
  return encryptWithKey(cached.key, plain)
}

/**
 * Decrypts a provider secret with the cached data key. Falls back to the raw env
 * secret for rows written before the data key existed, reporting `legacy` so the
 * caller can re-encrypt them under the data key. Synchronous and cache-only, so
 * the hot path never reads the database per key.
 */
export function decodeProviderSecret(envelope: string): { plaintext: string; legacy: boolean } {
  if (!cached) throw new AiConfigError('The AI data key is not loaded yet.', 503)
  try {
    return { plaintext: decryptWithKey(cached.key, envelope), legacy: false }
  } catch (primary) {
    const kek = parseEnvSecret()
    if (kek && !kek.equals(cached.key)) {
      try {
        return { plaintext: decryptWithKey(kek, envelope), legacy: true }
      } catch {
        // Not readable under the legacy secret either — report the DEK error.
      }
    }
    throw primary
  }
}

/** Bench-facing status. Never throws. */
export async function keyringStatus(prisma: KeyringPrisma): Promise<KeyringStatus> {
  try {
    const info = await loadOnce(prisma)
    return {
      ready: true,
      locked: false,
      mode: info.mode,
      message:
        info.mode === 'kek'
          ? 'Provider keys are encrypted under a data key wrapped by AI_KEY_ENCRYPTION_SECRET.'
          : 'Provider keys are encrypted under a data key stored with the database, so they open on any server with the same DATABASE_URL.',
    }
  } catch (error) {
    const config = error instanceof AiConfigError ? error : null
    return {
      ready: false,
      // "Locked" is specifically a wrapped data key that cannot be unwrapped;
      // a missing table or stale client is a different, fixable state.
      locked: config?.code === 'kek_required' || config?.code === 'kek_mismatch',
      mode: null,
      message: error instanceof Error ? error.message : 'The AI data key could not be loaded.',
    }
  }
}
