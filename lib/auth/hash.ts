import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * Password hashing for the custom account table (auth_accounts.password_hash).
 *
 * scrypt dependency-wide (node:crypto, no npm package) with per-password salt.
 * Stored format: `scrypt$<N>$<r>$<p>$<salt hex>$<hash hex>`. The cost
 * parameters ride inside the string so a future bump cannot stop old logins
 * from verifying — verification recomputes with the stored parameters, never
 * assumed defaults.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>

const DEFAULT_PARAMS = { N: 2 ** 14, r: 8, p: 1 } as const
const KEY_LEN = 64

export async function hashPassword(plaintext: string): Promise<string> {
  const { N, r, p } = DEFAULT_PARAMS
  const salt = randomBytes(16)
  const hash = await scryptAsync(plaintext, salt, KEY_LEN, { N, r, p })
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`
}

export async function verifyPassword(plaintext: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false
    const N = Number(parts[1])
    const r = Number(parts[2])
    const p = Number(parts[3])
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false
    const salt = Buffer.from(parts[4], 'hex')
    const expected = Buffer.from(parts[5], 'hex')
    if (!salt.length || !expected.length) return false
    const actual = await scryptAsync(plaintext, salt, expected.length, { N, r, p })
    return timingSafeEqual(actual, expected)
  } catch {
    // A malformed or truncated stored value must read as a wrong password,
    // never as a 500 — the login surface stays a safe constant response.
    return false
  }
}
