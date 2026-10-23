import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { adminPermissionRefusal, adminRefusal, checkAdminWriteRate, requireAdmin } from '@/lib/usage/admin'
import { creditDatabase, creditStoreError, validateCreditOrigin } from '@/lib/usage/credits'
import { adjustCredits, type CreditActor } from '@/lib/usage/credit-store'
import { CreditError, creditInteger, creditObject, creditReason, CREDIT_UUID } from '@/lib/usage/credit-policy'
import { readAccountStatus } from '@/lib/usage/store'

export async function POST(request: Request) {
  const requestId = randomUUID()
  const headers = { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' }
  try {
    const gate = await requireAdmin()
    if (!gate.ok) { const refusal = adminRefusal(gate); throw new CreditError(refusal.error, 'admin_required', refusal.status) }
    validateCreditOrigin(request)
    const permission = adminPermissionRefusal(gate, 'operator')
    if (permission) throw new CreditError(permission.error, 'operator_required', permission.status)
    if (!checkAdminWriteRate()) throw new CreditError('Too many changes. Try again in a minute.', 'admin_rate_limited', 429)
    let raw: unknown
    try { raw = await request.json() } catch { throw new CreditError('Invalid JSON.') }
    const body = creditObject(raw)
    const id = body.user_id ?? body.anon_id
    if ((body.user_id !== undefined && body.anon_id !== undefined) || typeof id !== 'string' || !CREDIT_UUID.test(id)) throw new CreditError('Choose exactly one valid user_id or anon_id.')
    const db = creditDatabase()
    let actor: CreditActor = { anonId: id, userId: null, active: true, unmetered: false }
    if (body.user_id !== undefined) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true } })
      if (!user) throw new CreditError('That account does not exist.', 'account_unknown', 404)
      const status = await readAccountStatus(id)
      actor = { anonId: id, userId: id, active: status.active, unmetered: status.active && (status.role === 'Owner' || status.role === 'Operator') }
    }
    const amount = creditInteger(body.amount, 'Adjustment', -1_000_000)
    if (typeof body.operation_id !== 'string' || !CREDIT_UUID.test(body.operation_id)) throw new CreditError('A valid operation_id UUID is required.')
    const result = await adjustCredits(db, actor, amount, creditReason(body.reason), body.operation_id, { actorId: gate.user.id, actorEmail: gate.user.email ?? null, requestId })
    return NextResponse.json(result, { headers })
  } catch (error) {
    const failure = creditStoreError(error)
    return NextResponse.json({ error: failure.message, code: failure.code, request_id: requestId }, { status: failure.status, headers })
  }
}
