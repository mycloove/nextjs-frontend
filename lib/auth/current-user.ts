import 'server-only'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
// The profile/status helpers are the product's identity store — one authority
// for "who may act" shared by the role route, quota and credits. Reading them
// from here keeps an identical answer for both identity systems.
import { ensureProfileRecord, readAccountStatus } from '@/lib/usage/store'
import { requireAuthPrisma } from './db'
import { AUTH_COOKIE } from './session'
import { tokenHash } from './tokens'

/**
 * ONE identity reader for every consumer that used to call
 * `supabase.auth.getUser()` directly (role route, quota, credits).
 *
 * Order:
 *  1. Custom account session (auth_accounts cookie) → its product user row.
 *  2. Supabase session fallback → Google / legacy email+password accounts.
 *
 * Returns the same shape for both, so callers never learn which system gave
 * the answer. `null` always means "not signed in".
 */

export type CurrentAccountUser = {
  /** users.id — the same uuid every Usage/Credit row already references. */
  userId: string
  accountId: string
  email: string
  emailVerified: boolean
  role: string
  active: boolean
}

async function userFromAccountSession(rawToken: string): Promise<CurrentAccountUser | null> {
  const prisma = requireAuthPrisma()
  const row = await prisma.authSession.findUnique({
    where: { tokenHash: tokenHash(rawToken) },
    select: {
      expiresAt: true,
      account: {
        select: {
          id: true,
          email: true,
          emailVerified: true,
          userId: true,
          user: { select: { id: true, email: true, role: true, active: true } },
        },
      },
    },
  })
  if (!row || row.expiresAt < new Date()) return null
  const account = row.account
  // Old signup versions issued sessions before verification. Those cookies
  // must read as signed out, including in quota, credit and role consumers.
  if (!account.emailVerified) return null
  if (!account.userId || !account.user) {
    // Not expected (profiles are created at signup); a broken link is a
    // signed-out browser, never a crash.
    return null
  }
  if (!account.user.active) {
    // A turned-off account reads as guest parity: signed out.
    return null
  }
  return {
    userId: account.user.id,
    accountId: account.id,
    email: account.user.email ?? account.email,
    emailVerified: account.emailVerified,
    role: account.user.role,
    active: account.user.active,
  }
}

async function userFromSupabaseSession(): Promise<CurrentAccountUser | null> {
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    const user = data.user
    if (!user) return null
    await ensureProfileRecord(user.id, user.email ?? null)
    const status = await readAccountStatus(user.id)
    if (!status.active) return null
    return {
      userId: user.id,
      // Supabase identities have no auth_accounts row yet: the id the routing
      // layer can compare is the product user row (same value here).
      accountId: user.id,
      email: user.email ?? '',
      emailVerified: true,
      role: status.role,
      active: status.active,
    }
  } catch {
    // Auth-service outage: report signed-out rather than crashing callers.
    return null
  }
}

export async function currentSessionUser(): Promise<CurrentAccountUser | null> {
  const jar = await cookies()
  const raw = jar.get(AUTH_COOKIE)?.value
  if (raw) {
    const direct = await userFromAccountSession(raw)
    if (direct) return direct
  }
  return userFromSupabaseSession()
}
