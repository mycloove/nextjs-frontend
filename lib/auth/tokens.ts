import { createHash, randomBytes } from 'node:crypto'

/**
 * One-time tokens for verification / reset mail. Only the SHA-256 of the token
 * is stored (auth_tokens.token_hash), so a database read can never redeem a
 * link. Raw tokens are 32 bytes of crypto-random shown exactly once.
 */

export function newAccountToken() {
  const raw = randomBytes(32).toString('hex')
  return { raw, tokenHash: tokenHash(raw) }
}

export function tokenHash(raw: string) {
  return createHash('sha256').update(raw).digest('hex')
}
