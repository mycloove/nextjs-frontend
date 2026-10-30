import { randomBytes } from 'node:crypto'
import { tokenHash } from './tokens'
import { getAuthPrisma } from './db'

/**
 * DB-backed sessions for the custom account table. The cookie value is a
 * 48-byte random token; `auth_sessions` stores only its SHA-256, so a row
 * dump cannot mint a login. Logout deletes the row — there is no refresh
 * dance to keep in the proxy because the TTL is absolute (30 days).
 */

export const AUTH_COOKIE = 'smilepdf_auth'
export const AUTH_SESSION_TTL_DAYS = 30

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: AUTH_SESSION_TTL_DAYS * 24 * 60 * 60,
} as const

export async function createAuthSession(accountId: string, userAgent: string | null) {
  const raw = randomBytes(48).toString('hex')
  const prisma = getAuthPrisma()
  if (!prisma) throw new Error('DATABASE_URL is not set. Apply the custom-auth migration, then restart.')
  const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
  await prisma.authSession.create({
    data: { tokenHash: tokenHash(raw), accountId, expiresAt, userAgent: userAgent?.slice(0, 200) ?? null },
  })
  return { raw, expiresAt }
}

export async function destroyAuthSession(rawToken: string | null | undefined) {
  if (!rawToken) return
  const prisma = getAuthPrisma()
  if (!prisma) return
  try {
    await prisma.authSession.delete({ where: { tokenHash: tokenHash(rawToken) } })
  } catch {
    // Unknown/expired token: nothing to delete, nothing to report.
  }
}
