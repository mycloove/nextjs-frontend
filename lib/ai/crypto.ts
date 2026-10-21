import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Provider keys are encrypted at rest with AES-256-GCM. The envelope format is
 * unchanged (`v1:<b64 iv12>:<b64 tag16>:<b64 ciphertext>`); what changed is
 * *which* key is used: the data key (DEK) that lives with the database, not a
 * machine-local env secret. See `keyring.ts` for the DEK lifecycle.
 *
 * This module is deliberately pure: it never reads the environment (except in
 * `parseEnvSecret`, which never throws) and never touches the database, so it can
 * be unit-tested and reused to wrap the DEK itself.
 */

const PREFIX = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16
export const KEY_BYTES = 32

/**
 * Raised when the broker cannot do its job for a configuration reason (missing
 * or malformed key, unreadable row). The admin routes map this to its `status`,
 * so a save against an unconfigured deployment answers with a clear message
 * instead of silently storing plaintext.
 */
export class AiConfigError extends Error {
  status: number
  /** Optional machine-readable reason (e.g. `kek_required`, `table_missing`). */
  code?: string
  constructor(message: string, status = 503, code?: string) {
    super(message)
    this.name = 'AiConfigError'
    this.status = status
    if (code) this.code = code
  }
}

/** A fresh 32-byte AES-256 key. */
export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES)
}

/**
 * Reads AI_KEY_ENCRYPTION_SECRET as a 32-byte buffer. Never throws: an absent or
 * malformed value yields null. When present it is the KEK that wraps the data
 * key (and, on a fresh database, is adopted as the data key itself).
 */
export function parseEnvSecret(): Buffer | null {
  const raw = process.env.AI_KEY_ENCRYPTION_SECRET
  if (!raw || !raw.trim()) return null
  const key = Buffer.from(raw.trim(), 'base64')
  if (key.length !== KEY_BYTES) return null
  return key
}

function requireKey(key: Buffer): Buffer {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new AiConfigError('The encryption key must decode to exactly 32 bytes.', 500)
  }
  return key
}

export function encryptWithKey(key: Buffer, plain: string): string {
  if (typeof plain !== 'string' || !plain.trim()) {
    throw new AiConfigError('A provider key is required.', 400)
  }
  const use = requireKey(key)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', use, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`
}

export function decryptWithKey(key: Buffer, envelope: string): string {
  if (typeof envelope !== 'string') {
    throw new AiConfigError('Stored key is not readable.', 500)
  }
  const parts = envelope.split(':')
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new AiConfigError('Stored key has an unknown format.', 500)
  }
  const use = requireKey(key)
  const iv = Buffer.from(parts[1], 'base64')
  const tag = Buffer.from(parts[2], 'base64')
  const ciphertext = Buffer.from(parts[3], 'base64')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new AiConfigError('Stored key is corrupt.', 500)
  }
  const decipher = createDecipheriv('aes-256-gcm', use, iv)
  decipher.setAuthTag(tag)
  // final() throws if the ciphertext or tag was tampered with — GCM integrity.
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw new AiConfigError(
      'This stored key cannot be decrypted with the current key. It was encrypted with a different key; re-add it with Rotate.',
      409,
      'key_mismatch',
    )
  }
}

/** Wraps a value under `key` (same envelope). Named for wrapping the DEK. */
export const reseal = encryptWithKey

export function last4Of(plain: string): string {
  const trimmed = (plain ?? '').trim()
  if (!trimmed) return ''
  return trimmed.length <= 4 ? trimmed : trimmed.slice(-4)
}

const PREFIX_LENGTH = 12

/**
 * A non-secret display prefix so a key can read "sk-or-v1-4d…d8f" instead of a
 * bare "…d8f". It never overlaps the `last4` window, and a key too short to mask
 * without revealing most of itself returns '' (the view then shows "…last4").
 */
export function prefixOf(plain: string): string {
  const trimmed = (plain ?? '').trim()
  if (trimmed.length <= 8) return ''
  return trimmed.slice(0, Math.min(PREFIX_LENGTH, trimmed.length - 4))
}

export function maskKey(plain: string): string {
  const last4 = last4Of(plain)
  const prefix = prefixOf(plain)
  if (prefix && last4) return `${prefix}…${last4}`
  return last4 ? `…${last4}` : '…'
}
