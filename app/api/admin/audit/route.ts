import { adminRefusal, requireAdmin } from '@/lib/usage/admin'
import { readAdminAuditEvents } from '@/lib/usage/controls'
import { NextResponse } from 'next/server'

const AUDIT_ACTIONS = new Set([
  'admin.bootstrap.create',
  'admin.seat.create',
  'admin.seat.restore',
  'admin.seat.activate',
  'admin.seat.deactivate',
  'admin.seat.delete',
  'tool.control.update',
  'tool.usage.reset',
  'usage.person.clear',
])

export async function GET(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) {
    const refusal = adminRefusal(gate)
    return NextResponse.json({ error: refusal.error }, { status: refusal.status })
  }

  const params = new URL(request.url).searchParams
  const rawTake = Number.parseInt(params.get('take') ?? '50', 10)
  const rawSkip = Number.parseInt(params.get('skip') ?? '0', 10)
  const action = params.get('action') ?? ''
  if (!Number.isInteger(rawTake) || rawTake < 1 || !Number.isInteger(rawSkip) || rawSkip < 0) {
    return NextResponse.json({ error: 'Invalid pagination.' }, { status: 400 })
  }
  if (action && !AUDIT_ACTIONS.has(action)) {
    return NextResponse.json({ error: 'Unknown audit action.' }, { status: 400 })
  }

  const result = await readAdminAuditEvents({ take: Math.min(rawTake, 100), skip: rawSkip, action: action || undefined })
  return NextResponse.json({ ...result.data, degraded: result.degraded, error: result.message || undefined })
}
