import {
  adminRefusal,
  checkAdminWriteRate,
  checkBootstrapToken,
  adminPermissionRefusal,
  deletePlatformAdmin,
  listPlatformAdmins,
  platformAdminExists,
  requireAdmin,
  SeatAdminError,
  seatPlatformAdmin,
  setPlatformAdminActive,
} from '@/lib/usage/admin'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Every bench response carries the request id, like the 24 tool routes do. */
function withRequestId(response: NextResponse, requestId: string) {
  response.headers.set('X-Request-Id', requestId)
  return response
}

function failure(error: unknown, fallback: string, requestId: string) {
  const message = error instanceof Error ? error.message : fallback
  const status = error instanceof SeatAdminError ? error.status : 500
  return withRequestId(NextResponse.json({ error: message, request_id: requestId }, { status }), requestId)
}

/** Throttle bench writes before touching Supabase Auth (B2-7). */
function throttled(requestId: string) {
  if (checkAdminWriteRate()) return null
  return withRequestId(
    NextResponse.json({ error: 'Too many admin changes. Wait a minute and try again.', request_id: requestId }, { status: 429 }),
    requestId,
  )
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  const gate = await requireAdmin()
  if (!gate.ok) {
    const refusal = adminRefusal(gate)
    return withRequestId(
      NextResponse.json({ error: refusal.error, request_id: requestId }, { status: refusal.status }),
      requestId,
    )
  }
  const permission = adminPermissionRefusal(gate, 'owner')
  if (permission) return withRequestId(NextResponse.json({ error: permission.error, request_id: requestId }, { status: permission.status }), requestId)
  try {
    const admins = await listPlatformAdmins()
    return withRequestId(NextResponse.json({ admins, request_id: requestId }), requestId)
  } catch (error) {
    return failure(error, 'Could not list admins', requestId)
  }
}

/**
 * Seats an admin. Password hashing is Supabase Auth (bcrypt in auth.users).
 * While no Admin profile exists, this call is the bootstrap. After that, only
 * a signed-in Admin can seat another one. When ADMIN_BOOTSTRAP_TOKEN is set,
 * the bootstrap call must also present it in the x-bootstrap-token header.
 */
export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  const deny = (error: string, status: number) =>
    withRequestId(NextResponse.json({ error, request_id: requestId }, { status }), requestId)

  let open = false
  let actor: { id: string; email?: string } | null = null
  try {
    open = !(await platformAdminExists())
  } catch (error) {
    return failure(error, 'Could not check admin roles', requestId)
  }

  if (open) {
    // B1-2: while no Admin profile exists the seat call is reachable without a
    // session. When the operator set ADMIN_BOOTSTRAP_TOKEN, the token closes
    // that window to anyone who does not hold it. Unset keeps the old open
    // bootstrap so self-host first-run still works.
    if (!checkBootstrapToken(request.headers.get('x-bootstrap-token'))) {
      return deny('A bootstrap token is required to seat the first admin.', 403)
    }
  } else {
    const gate = await requireAdmin()
    if (!gate.ok) {
      const refusal = adminRefusal(gate)
      return deny(refusal.error, refusal.status)
    }
    actor = gate.user
    const permission = adminPermissionRefusal(gate, 'owner')
    if (permission) return deny(permission.error, permission.status)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return deny('Invalid JSON', 400)
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const role = body.role === 'Operator' || body.role === 'Viewer' ? body.role : 'Owner'
  if (open && role !== 'Owner') return deny('The first bench seat must be an Owner.', 400)
  if (!EMAIL_PATTERN.test(email)) {
    return deny('A valid email is required', 400)
  }
  if (password.length < 8 || password.length > 72) {
    return deny('Password must be 8 to 72 characters', 400)
  }
  const limited = throttled(requestId)
  if (limited) return limited

  try {
    const seated = await seatPlatformAdmin(email, password, role, {
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      requestId,
    })
    return withRequestId(NextResponse.json({ ...seated, request_id: requestId }), requestId)
  } catch (error) {
    return failure(error, 'Could not create the admin', requestId)
  }
}

export async function PATCH(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  const gate = await requireAdmin()
  if (!gate.ok) {
    const refusal = adminRefusal(gate)
    return withRequestId(
      NextResponse.json({ error: refusal.error, request_id: requestId }, { status: refusal.status }),
      requestId,
    )
  }
  const permission = adminPermissionRefusal(gate, 'owner')
  if (permission) return withRequestId(NextResponse.json({ error: permission.error, request_id: requestId }, { status: permission.status }), requestId)

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return withRequestId(NextResponse.json({ error: 'Invalid JSON', request_id: requestId }, { status: 400 }), requestId)
  }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id || typeof body.active !== 'boolean') {
    return withRequestId(
      NextResponse.json({ error: 'id and active are required', request_id: requestId }, { status: 400 }),
      requestId,
    )
  }
  const limitedPatch = throttled(requestId)
  if (limitedPatch) return limitedPatch

  try {
    const admin = await setPlatformAdminActive(gate.user.id, id, body.active, {
      actorId: gate.user.id,
      actorEmail: gate.user.email ?? null,
      requestId,
    })
    return withRequestId(NextResponse.json({ admin, request_id: requestId }), requestId)
  } catch (error) {
    return failure(error, 'Could not update the admin', requestId)
  }
}

export async function DELETE(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  const gate = await requireAdmin()
  if (!gate.ok) {
    const refusal = adminRefusal(gate)
    return withRequestId(
      NextResponse.json({ error: refusal.error, request_id: requestId }, { status: refusal.status }),
      requestId,
    )
  }
  const permission = adminPermissionRefusal(gate, 'owner')
  if (permission) return withRequestId(NextResponse.json({ error: permission.error, request_id: requestId }, { status: permission.status }), requestId)

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return withRequestId(NextResponse.json({ error: 'Invalid JSON', request_id: requestId }, { status: 400 }), requestId)
  }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) {
    return withRequestId(
      NextResponse.json({ error: 'id is required', request_id: requestId }, { status: 400 }),
      requestId,
    )
  }
  const limitedDelete = throttled(requestId)
  if (limitedDelete) return limitedDelete

  try {
    await deletePlatformAdmin(gate.user.id, id, {
      actorId: gate.user.id,
      actorEmail: gate.user.email ?? null,
      requestId,
    })
    return withRequestId(NextResponse.json({ id, request_id: requestId }), requestId)
  } catch (error) {
    return failure(error, 'Could not delete the admin', requestId)
  }
}
