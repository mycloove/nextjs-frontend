import 'server-only'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { readAccountStatus, ensureProfileRecord } from '@/lib/usage/store'
import { AuthStoreMissing, getAuthPrisma, requireAuthPrisma } from './db'
import { hashPassword, verifyPassword } from './hash'
import { sendAccountMail } from './mail'
import { AUTH_COOKIE, createAuthSession, destroyAuthSession } from './session'
import { newAccountToken, tokenHash } from './tokens'

/**
 * The account service: every decision about email+password accounts lives in
 * this one module (lib/auth). Routes under app/api/auth are thin: requestId →
 * validate → call here → map AuthError to the shared error envelope.
 *
 * Email/password accounts stay independent of Supabase Auth:
 * - Sign-up is a database write. It succeeds even when the verify email
 *   cannot be delivered: the pending account exists and mail can be resent.
 * - Verification is required before login. Neither signup nor verification
 *   creates a session; the user signs in explicitly after confirming email.
 * - Errors a human can fix get a plain message and a machine code.
 */

export class AuthError extends Error {
  code: string
  status: number

  constructor(message: string, code: string, status = 400) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.status = status
  }
}

export const VERIFY_TTL_HOURS = 24
const MIN_PASSWORD = 8
/** Quiet period between two verification mails, so abuse cannot drain Brevo's 300/day. */
export const RESEND_QUIET_SECONDS = 60

export type CurrentAccountUser = {
  /** users.id — the same uuid every Usage/Credit row already references. */
  userId: string
  /** auth_accounts.id — the credential row, for session/token writes. */
  accountId: string
  email: string
  emailVerified: boolean
  role: string
  active: boolean
}

function normalizeEmail(raw: unknown): string {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!email || email.length > 254 || !email.includes('@')) {
    throw new AuthError('Enter a valid email address.', 'invalid_email')
  }
  return email
}

function passwordOf(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length < MIN_PASSWORD) {
    throw new AuthError(`Use at least ${MIN_PASSWORD} characters for the password.`, 'weak_password')
  }
  if (raw.length > 200) throw new AuthError('That password is too long.', 'weak_password')
  return raw
}

/** Message-preserving display name; empty becomes null (profile parity with the OAuth upsert). */
function displayNameOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().slice(0, 80)
  return trimmed || null
}

/**
 * Origin for the verify links. Comes from the request the user made (correct
 * behind Vercel's proxy for the browser-visible origin), with an env override
 * for deployments where links should always target the production domain.
 */
export function verifyOrigin(request: Request): string {
  const configured = process.env.APP_PUBLIC_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')
  return new URL(request.url).origin
}

/**
 * Creates a fresh signup_verify token (invalidating any previous one) and
 * sends it. Token row commits BEFORE the send: a mail outage leaves a valid,
 * resend-able token behind — never a dead link pointing at a missing account.
 */
async function issueAndMailVerification(input: {
  accountId: string
  to: string
  displayName: string | null
  origin: string
}): Promise<{ sent: boolean; reason?: string }> {
  const prisma = requireAuthPrisma()
  const { raw, tokenHash: hash } = newAccountToken()
  const expiresAt = new Date(Date.now() + VERIFY_TTL_HOURS * 3_600_000)
  await prisma.$transaction([
    // One live token per purpose: re-issuing (resend) invalidates the
    // previous link, so an accidentally forwarded earlier email is stale.
    prisma.verificationToken.deleteMany({ where: { accountId: input.accountId, purpose: 'signup_verify', usedAt: null } }),
    prisma.verificationToken.create({
      data: { tokenHash: hash, purpose: 'signup_verify', accountId: input.accountId, expiresAt },
    }),
  ])
  const mail = await sendAccountMail({
    to: input.to,
    purpose: 'signup_verify',
    ctaUrl: `${input.origin}/auth/verify?token=${raw}`,
    displayName: input.displayName,
    expiresInHours: VERIFY_TTL_HOURS,
    origin: input.origin,
  })
  return { sent: mail.sent, reason: mail.reason }
}

export type SignupResult = {
  userId: string
  email: string
  emailVerified: boolean
  /** Whether the mail service accepted the verification email, not inbox delivery. */
  mailSent: boolean
  mailReason?: string
}

/**
 * Creates the account + the product profile in one write, then emails the
 * verify link. Intentionally NO Supabase call anywhere in this path — that is
 * exactly the dependency this module removes, along with its rate limits and
 * shared SMTP quota. Delivery uses this module's server-only Brevo HTTPS
 * sender; the PDF service is not involved in account creation or email.
 */
export async function signupAccount(input: {
  body: Record<string, unknown>
  origin: string
}): Promise<SignupResult> {
  const email = normalizeEmail(input.body.email)
  const password = passwordOf(input.body.password)
  const displayName = displayNameOf(input.body.display_name)

  const prisma = requireAuthPrisma()
  const existing = await prisma.authAccount.findUnique({ where: { email }, select: { id: true } })
  if (existing) {
    throw new AuthError(
      'That email already has an account. Try logging in instead.',
      'email_taken',
      409,
    )
  }

  // Hash BEFORE the transaction: no slow scrypt inside a db write, so a
  // concurrent pre-check race window stays a few milliseconds wide.
  const passwordHash = await hashPassword(password)
  // A pre-custom-account profile row (legacy Supabase identity) is never
  // duplicated: the new credential links to that same row, so their recorded
  // usage, credits and avatar follow them into the custom system untouched.
  const legacyProfile = await prisma.user.findFirst({ where: { email }, select: { id: true } })
  const userId = legacyProfile?.id ?? crypto.randomUUID()

  let accountId: string
  try {
    // One transaction: profile + credential appear together or not at all.
    // The profile create runs only for a brand-new identity; when a legacy
    // profile row is linked instead, ensureProfileRecord is deliberately
    // skipped — the row exists and must not be rewritten.
    const account = await prisma.$transaction(async (tx) => {
      if (!legacyProfile) {
        await tx.user.create({ data: { id: userId, email, role: 'User' } })
      }
      return tx.authAccount.create({
        data: {
          email,
          passwordHash,
          displayName,
          emailVerified: false,
          userId,
          // A linked legacy row is by definition a Supabase-era identity.
          ...(legacyProfile ? { legacySupabaseUserId: legacyProfile.id } : {}),
        },
      })
    })
    accountId = account.id
  } catch (error: unknown) {
    // P2002 on email: a concurrent signup won the race. Same friendly answer.
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002') {
      throw new AuthError('That email already has an account. Try logging in instead.', 'email_taken', 409)
    }
    throw error
  }

  const mail = await issueAndMailVerification({
    accountId,
    to: email,
    displayName,
    origin: input.origin,
  })

  return {
    userId,
    email,
    emailVerified: false,
    mailSent: mail.sent,
    mailReason: mail.reason,
  }
}

export type LoginResult = {
  userId: string
  accountId: string
  email: string
  emailVerified: boolean
  role: string
  active: boolean
  sessionToken: string
}

export async function loginAccount(input: {
  body: Record<string, unknown>
  userAgent: string | null
}): Promise<LoginResult> {
  const email = normalizeEmail(input.body.email)
  const password = typeof input.body.password === 'string' ? input.body.password : ''
  if (!email || !password) {
    throw new AuthError('Enter your email and password to continue.', 'missing_credentials', 400)
  }

  const prisma = requireAuthPrisma()
  const account = await prisma.authAccount.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, userId: true, emailVerified: true },
  })

  if (!account) {
    // Legacy bridge (lazy migration): the address may still live only in
    // Supabase Auth — pre-custom era email+password users. The SAME password
    // the user just typed is verified against Supabase; on a hit the custom
    // row is provisioned with a fresh hash of it, so every following login is
    // pure database and Supabase is out of the loop. A miss stays the single
    // generic "incorrect" answer.
    const provisioned = await bridgeLegacySupabaseAccount(email, password, prisma)
    if (!provisioned) {
      throw new AuthError('Email or password is incorrect.', 'invalid_credentials', 401)
    }
    return continueSignIn({
      prisma,
      accountId: provisioned.accountId,
      userId: provisioned.userId,
      email,
      emailVerified: provisioned.emailVerified,
      userAgent: input.userAgent,
    })
  }

  const ok = await verifyPassword(password, account.passwordHash)
  if (!ok) throw new AuthError('Email or password is incorrect.', 'invalid_credentials', 401)

  return continueSignIn({
    prisma,
    accountId: account.id,
    userId: account.userId,
    email,
    emailVerified: account.emailVerified,
    userAgent: input.userAgent,
  })
}

type ProvisionedLegacy = { accountId: string; userId: string; emailVerified: boolean }

async function bridgeLegacySupabaseAccount(email: string, password: string, prisma: ReturnType<typeof requireAuthPrisma>): Promise<ProvisionedLegacy | null> {
  try {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.user) return null
    const supabaseId = data.user.id

    await ensureProfileRecord(supabaseId, data.user.email ?? email)
    const status = await readAccountStatus(supabaseId)
    if (!status.active) return null

    // Store the credential the user just proved: the same scrypt discipline,
    // so their password keeps working after Supabase Auth is retired.
    const passwordHash = await hashPassword(password)
    const account = await prisma.authAccount.create({
      data: {
        email,
        passwordHash,
        emailVerified: true,
        legacySupabaseUserId: supabaseId,
        userId: supabaseId,
      },
    })
    return { accountId: account.id, userId: supabaseId, emailVerified: true }
  } catch (error) {
    // Bridge failures must read as an ordinary wrong password, not a 500 —
    // but log loudly, because a silent transport error here could lock an
    // existing user out while their Supabase side is perfectly fine.
    console.error('Legacy Supabase bridge failed', { email: `${email.slice(0, 3)}***`, error: error instanceof Error ? error.message : error })
    return null
  }
}

type AccountRow = { id: string; userId: string | null; emailVerified: boolean }

async function continueSignIn(input: {
  prisma: ReturnType<typeof requireAuthPrisma>
  accountId: string
  userId: string | null
  email: string
  emailVerified: boolean
  userAgent: string | null
}): Promise<LoginResult> {
  const { prisma, accountId, userId, email, emailVerified, userAgent } = input

  // Check after the password is proved, but before any session/profile writes.
  // A pending account must not become authenticated by submitting login directly.
  if (!emailVerified) {
    throw new AuthError(
      'Verify your email before logging in. Check your inbox and spam folder, or request a new verification link.',
      'email_unverified',
      403,
    )
  }

  // Defensive: the profile row always exists, but a migration-era hole must
  // not dead-end a login.
  let resolvedUserId = userId
  if (!resolvedUserId) {
    const fresh = crypto.randomUUID()
    await prisma.user.create({ data: { id: fresh, email, role: 'User' } })
    await prisma.authAccount.update({ where: { id: accountId }, data: { userId: fresh, lastLoginAt: new Date() } })
    resolvedUserId = fresh
  }
  const accountRow: AccountRow = {
    id: accountId,
    userId: resolvedUserId,
    emailVerified,
  }
  const status = await readAccountStatus(accountRow.userId!).catch(() => ({ active: true, role: 'User' as const }))
  if (!status.active) {
    throw new AuthError('This account is turned off.', 'account_disabled', 403)
  }

  const { raw: sessionToken } = await createAuthSession(accountRow.id, userAgent)
  await prisma.authAccount.update({ where: { id: accountRow.id }, data: { lastLoginAt: new Date() } })

  return {
    userId: accountRow.userId!,
    accountId: accountRow.id,
    email,
    emailVerified: accountRow.emailVerified,
    role: status.role,
    active: true,
    sessionToken,
  }
}

/**
 * Consumes the verify link token: marks the row used and the account verified
 * in one transaction. Unknown/expired/stale links all answer "expired" — the
 * endpoint cannot be probed for which emails exist.
 */
export async function consumeVerification(rawToken: string): Promise<'ok' | 'expired'> {
  if (!/^[0-9a-f]{64}$/.test(rawToken)) return 'expired'
  const prisma = getAuthPrisma()
  if (!prisma) throw new AuthStoreMissing()
  const hash = tokenHash(rawToken)
  const updated = await prisma.$transaction(async (tx) => {
    const now = new Date()
    const row = await tx.verificationToken.findUnique({ where: { tokenHash: hash } })
    if (!row || row.purpose !== 'signup_verify' || row.usedAt || row.expiresAt <= now) return false
    const consumed = await tx.verificationToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    })
    if (consumed.count !== 1) return false
    // Revoke sessions issued by the old auto-login signup flow. Otherwise
    // confirming email would reactivate those cookies without a fresh login.
    await tx.authSession.deleteMany({ where: { accountId: row.accountId } })
    await tx.authAccount.update({ where: { id: row.accountId }, data: { emailVerified: true } })
    return true
  })
  return updated ? 'ok' : 'expired'
}

/**
 * Resend. Always answers ok (and does nothing) when the email is not a live,
 * unverified account, so this endpoint cannot enumerate mailboxes. The quiet
 * period keeps one person from draining Brevo's 300/day budget.
 */
export async function resendVerification(input: {
  body: Record<string, unknown>
  origin: string
}): Promise<{ ok: true }> {
  const email = normalizeEmail(input.body.email)
  const prisma = requireAuthPrisma()
  const account = await prisma.authAccount.findUnique({
    where: { email },
    select: { id: true, displayName: true, emailVerified: true },
  })
  if (!account || account.emailVerified) return { ok: true }

  const recent = await prisma.verificationToken.findFirst({
    where: {
      accountId: account.id,
      purpose: 'signup_verify',
      createdAt: { gt: new Date(Date.now() - RESEND_QUIET_SECONDS * 1000) },
    },
    select: { id: true },
  })
  if (recent) {
    // Not an error: the earlier mail is still valid; wait for the same inbox.
    return { ok: true }
  }

  await issueAndMailVerification({
    accountId: account.id,
    to: email,
    displayName: account.displayName ?? null,
    origin: input.origin,
  })
  return { ok: true }
}

export async function logout(rawToken: string | null | undefined) {
  await destroyAuthSession(rawToken)
}

/** Route handlers read the cookie from the Request — no next/headers dependency here. */
export function readCookieToken(request: Request): string | null {
  const header = request.headers.get('cookie') ?? ''
  const pair = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTH_COOKIE}=`))
  return pair ? decodeURIComponent(pair.slice(AUTH_COOKIE.length + 1)) : null
}
