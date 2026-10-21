import { clearAdminPersonUsage } from '@/lib/usage/controls'
import { adminPermissionRefusal, adminRefusal, checkAdminWriteRate, requireAdmin, SeatAdminError, setPlatformUserActive } from '@/lib/usage/admin'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Every bench response carries the request id, like the 24 tool routes do. */
function withRequestId(response: NextResponse, requestId: string) {
  response.headers.set('X-Request-Id', requestId)
  return response
}

function fail(message: string, status: number, requestId: string) {
  return withRequestId(NextResponse.json({ error: message, request_id: requestId }, { status }), requestId)
}

/**
 * Clears the recorded calls of one person, on every tool.
 *
 * This is the only write on the users desk, and it is deliberately narrower
 * than /api/admin/tools: that one resets a tool's tally for everyone or for one
 * named account, this one resets one browser or one account across the whole
 * bench. Neither can undo the other, so both are kept.
 */
export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  const gate = await requireAdmin()
  if (!gate.ok) {
    const refusal = adminRefusal(gate)
    return fail(refusal.error, refusal.status, requestId)
  }
  const permission = adminPermissionRefusal(gate, 'operator')
  if (permission) return fail(permission.error, permission.status, requestId)

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return fail('Invalid JSON', 400, requestId)
  }

  const userId = typeof body.user_id === 'string' ? body.user_id.trim() : ''
  const anonId = typeof body.anon_id === 'string' ? body.anon_id.trim() : ''
  if (userId && !UUID_PATTERN.test(userId)) {
    return fail('user_id is not an account id.', 400, requestId)
  }
  if (anonId && !UUID_PATTERN.test(anonId)) {
    return fail('anon_id is not a browser id.', 400, requestId)
  }
  if (!userId && !anonId) {
    return fail('user_id or anon_id is required', 400, requestId)
  }
  if (!checkAdminWriteRate()) {
    return fail('Too many admin changes. Wait a minute and try again.', 429, requestId)
  }

  // Account status toggle (regular users only — setUserActive refuses bench
  // roles, so admins are still managed on the admins desk).
  const active = body.active
  if (typeof active === 'boolean') {
    if (!userId) return fail('A user_id is required to change account status.', 400, requestId)
    try {
      const row = await setPlatformUserActive(
        gate.user.id,
        userId,
        active,
        { actorId: gate.user.id, actorEmail: gate.user.email ?? null, requestId },
      )
      return withRequestId(NextResponse.json({ id: row.id, active: row.active, request_id: requestId }), requestId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not change that account'
      const status = error instanceof SeatAdminError ? error.status : 400
      return fail(message, status, requestId)
    }
  }

  try {
    const deleted = await clearAdminPersonUsage(
      { userId: userId || undefined, anonId: anonId || undefined },
      { actorId: gate.user.id, actorEmail: gate.user.email ?? null, requestId },
    )
    return withRequestId(NextResponse.json({ deleted, request_id: requestId }), requestId)
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Could not clear those calls', 400, requestId)
  }
}
