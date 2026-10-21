import { adminPermissionRefusal, adminRefusal, checkAdminWriteRate, findAuthUserIdByEmail, requireAdmin } from '@/lib/usage/admin'
import {
  listAdminToolControls,
  patchAdminToolControl,
  resetAdminToolUsage,
  ToolVersionConflict,
  updateAdminToolControl,
} from '@/lib/usage/controls'
import type { UsagePeriod } from '@/lib/usage/types'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'

/** Every bench response carries the request id, like the 24 tool routes do. */
function withRequestId(response: NextResponse, requestId: string) {
  response.headers.set('X-Request-Id', requestId)
  return response
}

function fail(message: string, status: number, requestId: string) {
  return withRequestId(NextResponse.json({ error: message, request_id: requestId }, { status }), requestId)
}

/** Throttle bench writes before touching the store (B2-7). */
function throttled(requestId: string) {
  if (checkAdminWriteRate()) return null
  return fail('Too many admin changes. Wait a minute and try again.', 429, requestId)
}

/**
 * Maps a store-layer version conflict to 409 + the fresh row. The desk
 * replaces server truth with it and keeps the operator's typed draft, so a
 * concurrent edit costs one re-save instead of silently lost caps.
 */
function failOrConflict(error: unknown, fallback: string, requestId: string) {
  if (error instanceof ToolVersionConflict) {
    return withRequestId(
      NextResponse.json({ error: error.message, code: 'version_conflict', tool: error.tool, request_id: requestId }, { status: 409 }),
      requestId,
    )
  }
  return fail(error instanceof Error ? error.message : fallback, 400, requestId)
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  const gate = await requireAdmin()
  if (!gate.ok) {
    const refusal = adminRefusal(gate)
    return fail(refusal.error, refusal.status, requestId)
  }
  try {
    const tools = await listAdminToolControls()
    return withRequestId(NextResponse.json({ tools, request_id: requestId }), requestId)
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Could not list tools', 500, requestId)
  }
}

export async function PUT(request: Request) {
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

  const toolId = typeof body.tool_id === 'string' ? body.tool_id.trim() : ''
  const period: UsagePeriod | null = body.period === 'week' ? 'week' : body.period === 'day' ? 'day' : null
  const guestLimit = typeof body.guest_limit === 'number' ? body.guest_limit : Number(body.guest_limit)
  const memberLimit = typeof body.member_limit === 'number' ? body.member_limit : Number(body.member_limit)
  const expectedUpdatedAt = typeof body.expected_updated_at === 'string' ? body.expected_updated_at : null
  if (!toolId || !period || typeof body.enabled !== 'boolean' || !Number.isFinite(guestLimit) || guestLimit < 0 || !Number.isFinite(memberLimit) || memberLimit < 0) {
    return fail('tool_id, enabled, period, guest_limit, and member_limit are required', 400, requestId)
  }
  const limitedPut = throttled(requestId)
  if (limitedPut) return limitedPut

  try {
    const tool = await updateAdminToolControl({
      tool_id: toolId,
      enabled: body.enabled,
      guest_limit: Math.floor(guestLimit),
      member_limit: Math.floor(memberLimit),
      period,
      expected_updated_at: expectedUpdatedAt,
      audit: { actorId: gate.user.id, actorEmail: gate.user.email ?? null, requestId },
    })
    return withRequestId(NextResponse.json({ tool, request_id: requestId }), requestId)
  } catch (error) {
    return failOrConflict(error, 'Could not save tool', requestId)
  }
}

/**
 * Partial write. The bench writes a tool from two independent controls — the
 * cap form and the on/off switch — so a full-object PUT made the switch silently
 * revert whatever the cap form had typed but not saved. PATCH sends only the
 * fields that changed. PUT is untouched and still serves whole-row callers.
 */
export async function PATCH(request: Request) {
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

  const toolId = typeof body.tool_id === 'string' ? body.tool_id.trim() : ''
  if (!toolId) {
    return fail('tool_id is required', 400, requestId)
  }

  const fields: Record<string, unknown> = {}
  if (typeof body.enabled === 'boolean') fields.enabled = body.enabled
  if (body.period === 'week' || body.period === 'day') fields.period = body.period
  for (const key of ['guest_limit', 'member_limit'] as const) {
    if (body[key] === undefined) continue
    const value = typeof body[key] === 'number' ? body[key] : Number(body[key])
    if (!Number.isFinite(value) || value < 0) {
      return fail(`${key} must be zero or more`, 400, requestId)
    }
    fields[key] = Math.floor(value)
  }
  if (!Object.keys(fields).length) {
    return fail('Nothing to save.', 400, requestId)
  }
  const expectedUpdatedAt = typeof body.expected_updated_at === 'string' ? body.expected_updated_at : null
  const limitedPatch = throttled(requestId)
  if (limitedPatch) return limitedPatch

  try {
    const tool = await patchAdminToolControl(toolId, fields, expectedUpdatedAt, {
      actorId: gate.user.id,
      actorEmail: gate.user.email ?? null,
      requestId,
    })
    return withRequestId(NextResponse.json({ tool, request_id: requestId }), requestId)
  } catch (error) {
    return failOrConflict(error, 'Could not save tool', requestId)
  }
}

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

  const toolId = typeof body.tool_id === 'string' ? body.tool_id.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!toolId) {
    return fail('tool_id is required', 400, requestId)
  }
  const limitedPost = throttled(requestId)
  if (limitedPost) return limitedPost

  try {
    let userId: string | null = null
    if (email) {
      userId = await findAuthUserIdByEmail(email)
      if (!userId) {
        return fail('No account with that email.', 404, requestId)
      }
    }
    const deleted = await resetAdminToolUsage(toolId, userId, {
      actorId: gate.user.id,
      actorEmail: gate.user.email ?? null,
      requestId,
    })
    return withRequestId(NextResponse.json({ deleted, request_id: requestId }), requestId)
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Could not reset usage', 400, requestId)
  }
}
