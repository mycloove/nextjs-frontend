import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * The CSRF guard for the GitHub install → callback handoff.
 *
 * GitHub's App install flow cannot carry a `state` parameter we control, so the
 * protection is a **cookie-bound one-time nonce**: `/install` mints a signed
 * nonce and sets it as an HttpOnly cookie, and `/callback` refuses to bind an
 * installation unless that cookie verifies. An attacker cannot forge the cookie
 * (HttpOnly + same-site + signed), so a hand-crafted callback URL that would
 * otherwise let them bind their own installation to a signed-in visitor's account
 * is rejected.
 *
 * The sign/verify functions are pure — the secret is passed in, not read from the
 * environment — so they are unit-tested with a fixed key. Only the routes read
 * `GITHUB_APP_CLIENT_SECRET` for the secret.
 */

export const PENDING_STATE_COOKIE = 'mr-markdown-gh-pending'
export const PENDING_STATE_TTL_MS = 10 * 60 * 1000

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function equalConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** Mints a fresh signed, self-expiring nonce. */
export function createPendingState(secret: string, now: number = Date.now()): string {
  const nonce = randomBytes(18).toString('base64url')
  const expiry = now + PENDING_STATE_TTL_MS
  const payload = `${nonce}.${expiry}`
  return `${payload}.${sign(secret, payload)}`
}

/** Verifies signature, shape and expiry. Never throws on malformed input. */
export function verifyPendingState(secret: string, value: string | undefined | null, now: number = Date.now()): boolean {
  if (!value) return false
  const parts = value.split('.')
  if (parts.length !== 3) return false
  const [nonce, expiryRaw, signature] = parts
  if (!nonce || !expiryRaw || !signature) return false
  const expiry = Number.parseInt(expiryRaw, 10)
  if (!Number.isFinite(expiry) || expiry <= now) return false
  return equalConstantTime(signature, sign(secret, `${nonce}.${expiryRaw}`))
}

/**
 * The cookie options for the pending nonce. `sameSite: 'lax'` is required: the
 * callback arrives as a top-level navigation from github.com, and a `strict`
 * cookie would be withheld on exactly that request.
 */
export function pendingCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(PENDING_STATE_TTL_MS / 1000),
  }
}
