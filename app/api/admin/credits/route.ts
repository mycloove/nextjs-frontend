import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { adminPermissionRefusal, adminRefusal, checkAdminWriteRate, requireAdmin } from '@/lib/usage/admin'
import { creditDatabase, creditStoreError, validateCreditOrigin } from '@/lib/usage/credits'
import { readAdminCreditAccount, readCreditPolicy, saveCreditFeature, saveCreditOverride, saveCreditPolicy, saveCreditPrice, type CreditActor } from '@/lib/usage/credit-store'
import { CreditError, creditInteger, creditObject, creditReason, CREDIT_UUID, validateCreditPolicy } from '@/lib/usage/credit-policy'
import { readAccountStatus } from '@/lib/usage/store'

export const runtime = 'nodejs'

function json(body: unknown, requestId: string, status = 200) {
  return NextResponse.json(body, { status, headers: { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' } })
}

async function targetActor(value: Record<string, unknown>): Promise<CreditActor> {
  const user = value.user_id
  const guest = value.anon_id
  if ((user !== undefined && guest !== undefined) || (user === undefined && guest === undefined)) throw new CreditError('Choose exactly one user_id or anon_id.')
  const id = user ?? guest
  if (typeof id !== 'string' || !CREDIT_UUID.test(id)) throw new CreditError('A valid identity UUID is required.')
  if (typeof user === 'string') {
    const row = await creditDatabase().user.findUnique({ where: { id: user }, select: { id: true } })
    if (!row) throw new CreditError('That account does not exist.', 'account_unknown', 404)
    const status = await readAccountStatus(user)
    return { anonId: user, userId: user, active: status.active, unmetered: status.active && (status.role === 'Owner' || status.role === 'Operator') }
  }
  return { anonId: id, userId: null, active: true, unmetered: false }
}

async function handle(request: Request, action: 'read' | 'policy' | 'price' | 'override') {
  const requestId = randomUUID()
  let stage = 'admin_gate'
  try {
    const gate = await requireAdmin()
    if (!gate.ok) {
      const refused = adminRefusal(gate)
      return json({ error: refused.error, code: 'admin_required', request_id: requestId }, requestId, refused.status)
    }
    if (action !== 'read') {
      validateCreditOrigin(request)
      const permission = adminPermissionRefusal(gate, 'operator')
      if (permission) return json({ error: permission.error, code: 'operator_required', request_id: requestId }, requestId, permission.status)
      if (!checkAdminWriteRate()) throw new CreditError('Too many changes. Try again in a minute.', 'admin_rate_limited', 429)
    }
    stage = 'credit_database'
    const db = creditDatabase()
    const audit = { actorId: gate.user.id, actorEmail: gate.user.email ?? null, requestId }
    if (action === 'read') {
      const url = new URL(request.url)
      if (url.searchParams.has('user_id') || url.searchParams.has('anon_id')) {
        stage = 'account_read'
        const target = Object.fromEntries(url.searchParams)
        return json(await readAdminCreditAccount(db, await targetActor(target)), requestId)
      }
      stage = 'policy_read'
      return json({ policy: await readCreditPolicy(db) }, requestId)
    }
    let raw: unknown
    try { raw = await request.json() } catch { throw new CreditError('Invalid JSON.') }
    const body = creditObject(raw)
    if (action === 'policy') {
      stage = 'policy_write'
      return json({ policy: await saveCreditPolicy(db, validateCreditPolicy(body), audit) }, requestId)
    }
    if (action === 'price') {
      stage = 'price_write'
      if (typeof body.tool_id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(body.tool_id)) throw new CreditError('A valid tool_id is required.')
      if (typeof body.enabled === 'boolean' && body.cost === undefined) {
        return json({ policy: await saveCreditFeature(db, body.tool_id, body.enabled, creditInteger(body.expected_version, 'Price version', 1), audit) }, requestId)
      }
      if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new CreditError('enabled must be a boolean.')
      if (typeof body.enabled === 'boolean') throw new CreditError('Save the feature setting and price separately.')
      if (body.cost === undefined) throw new CreditError('A cost or enabled value is required.')
      return json({ policy: await saveCreditPrice(db, body.tool_id, creditInteger(body.cost, 'Cost'), creditInteger(body.expected_version, 'Price version', 1), audit) }, requestId)
    }
    stage = 'override_write'
    const actor = await targetActor(body)
    if (!actor.userId) throw new CreditError('Allowance overrides require a signed-in account.')
    const allowance = body.allowance_override === null ? null : creditInteger(body.allowance_override, 'Allowance override')
    let expiresAt: Date | null = null
    if (body.override_expires_at !== null && body.override_expires_at !== undefined) {
      if (typeof body.override_expires_at !== 'string') throw new CreditError('Invalid override expiry.')
      expiresAt = new Date(body.override_expires_at)
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) throw new CreditError('Override expiry must be a valid future time.')
    }
    return json(await saveCreditOverride(db, actor, { allowance, expiresAt, expectedRevision: creditInteger(body.expected_revision, 'Account revision'), reason: creditReason(body.reason) }, audit), requestId)
  } catch (error) {
    if (!(error instanceof CreditError)) {
      const details = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown } : null
      console.error('[admin/credits] request failed', {
        requestId,
        action,
        stage,
        errorName: typeof details?.name === 'string' ? details.name : typeof error,
        errorCode: typeof details?.code === 'string' ? details.code : undefined,
      })
    }
    const failure = creditStoreError(error)
    return json({ error: failure.message, code: failure.code, request_id: requestId }, requestId, failure.status)
  }
}

export const GET = (request: Request) => handle(request, 'read')
export const PUT = (request: Request) => handle(request, 'policy')
export const PATCH = (request: Request) => handle(request, 'price')
export const POST = (request: Request) => handle(request, 'override')
