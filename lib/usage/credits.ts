import { createHash, randomUUID } from 'node:crypto'
// Identity comes from lib/auth's single reader — custom cookie session first,
// Supabase (Google/legacy) bridge second. Same shape for both, so the credit
// actor never depends on which system authenticated the browser.
import { currentSessionUser } from '@/lib/auth/current-user'
import { getPrisma, UsageStoreMissing } from './store'
import { claimGuestCredits, readCreditBalance, type CreditActor } from './credit-store'
import { CreditError } from './credit-policy'
import type { CreditSnapshot } from './credit-types'

export function creditDatabase() {
  const db = getPrisma()
  if (!db) throw new CreditError('Credit storage is not configured.', 'credit_store_missing', 503)
  return db
}

export function creditStoreError(error: unknown): CreditError {
  if (error instanceof CreditError) return error
  if (error instanceof UsageStoreMissing || (error && typeof error === 'object' && 'code' in error && ['P2021', 'P2022'].includes(String(error.code)))) {
    return new CreditError('Apply the credit-account migration before enabling credits.', 'credit_schema_missing', 503)
  }
  return new CreditError('Credit tracking is temporarily unavailable. Try again shortly.', 'credits_unavailable', 503)
}

export async function resolveCreditActor(anonId: string): Promise<CreditActor> {
  const user = await currentSessionUser()
  if (!user) return { anonId, userId: null, active: true, unmetered: false }
  // currentSessionUser already ran ensureProfileRecord + readAccountStatus on
  // both identity paths and reads an inactive account as signed-out, matching
  // the guest-parity rule the quota wrapper applies.
  return { anonId, userId: user.userId, active: true, unmetered: user.role === 'Owner' || user.role === 'Operator' }
}

export function legacyCreditSnapshot(actor: CreditActor, message = 'Credit accounts are not enabled. Existing tool usage limits still apply.'): CreditSnapshot {
  return { mode: 'legacy', audience: actor.userId ? 'member' : 'guest', account_active: actor.active,
    available: null, allowance: null, used: null, reserved: null, period_hours: 24, next_return_at: null,
    next_return_amount: 0, revision: 0, as_of: new Date().toISOString(), prices: {}, message }
}

export async function loadCreditSnapshot(actor: CreditActor) {
  try {
    return await readCreditBalance(creditDatabase(), actor)
  } catch (error) {
    const failure = creditStoreError(error)
    if (failure.code === 'credit_schema_missing' || failure.code === 'credit_store_missing') return legacyCreditSnapshot(actor)
    throw failure
  }
}

export async function linkGuestCreditActivity(actor: CreditActor) {
  try { return await claimGuestCredits(creditDatabase(), actor) }
  catch (error) { throw creditStoreError(error) }
}

export function validateCreditOrigin(request: Request) {
  const origin = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  if (site === 'cross-site') throw new CreditError('Cross-site credit changes are not allowed.', 'invalid_origin', 403)
  if (origin && origin !== new URL(request.url).origin) throw new CreditError('This request came from another origin.', 'invalid_origin', 403)
}

export function creditRequestId(request: Request) {
  const id = request.headers.get('x-request-id')?.trim()
  if (id && !/^[A-Za-z0-9._:-]{1,128}$/.test(id)) throw new CreditError('Invalid request id.')
  return id || randomUUID()
}

export async function creditRequestFingerprint(request: Request, parsedBody?: FormData | unknown) {
  // Clone BEFORE route-local form/json parsing consumes the original body.
  // The fingerprint is not document storage; only its SHA-256 enters the ledger.
  const hash = createHash('sha256')
  const url = new URL(request.url)
  hash.update(`${request.method}:${url.pathname}${url.search}\n`)
  const contentType = request.headers.get('content-type') ?? ''
  if (parsedBody instanceof FormData || contentType.includes('multipart/form-data')) {
    const form = parsedBody instanceof FormData ? parsedBody : await request.clone().formData()
    const entries = Array.from(form.entries()).sort(([a], [b]) => a.localeCompare(b))
    let size = 0
    for (const [key, value] of entries) {
      hash.update(JSON.stringify(key))
      if (typeof value === 'string') hash.update(`text:${JSON.stringify(value)}\n`)
      else {
        size += value.size
        if (size > 110 * 1024 * 1024) throw new CreditError('This request is too large.', 'file_too_large', 413)
        hash.update(`file:${JSON.stringify([value.name, value.type, value.size])}\n`)
        hash.update(new Uint8Array(await value.arrayBuffer()))
      }
    }
  } else if (parsedBody !== undefined) {
    const serialized = JSON.stringify(parsedBody)
    if (serialized.length > 110 * 1024 * 1024) throw new CreditError('This request is too large.', 'file_too_large', 413)
    hash.update(serialized)
  } else if (request.body) {
    const reader = request.clone().body!.getReader()
    let size = 0
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > 110 * 1024 * 1024) throw new CreditError('This request is too large.', 'file_too_large', 413)
        hash.update(part.value)
      }
    } finally { reader.releaseLock() }
  }
  return hash.digest('hex')
}
