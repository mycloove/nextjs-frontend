import { currentSessionUser } from '@/lib/auth/current-user'
import { TOOL_CATALOG } from '@/lib/usage/catalog'
import { recordSuccessfulFeatureUsage } from '@/lib/usage/store'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Accepts only minimal completion events from authenticated client-only tools. */
export async function POST(request: Request) {
  const requestId = randomUUID()
  // Unified identity reader: custom account session → Supabase bridge.
  const user = await currentSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  try {
    const body = await request.json() as Record<string, unknown>
    const toolId = typeof body.tool_id === 'string' ? body.tool_id : ''
    const eventId = typeof body.event_id === 'string' ? body.event_id : ''
    if (!TOOL_CATALOG.some((tool) => tool.tool_id === toolId) || !UUID_PATTERN.test(eventId)) {
      return NextResponse.json({ error: 'Invalid feature event' }, { status: 400 })
    }
    // Optional processed file name (client-only tools). Sanitized and capped in
    // recordSuccessfulFeatureUsage, so an oversized or path-like value is safe.
    const fileName = typeof body.file_name === 'string' ? body.file_name : null
    await recordSuccessfulFeatureUsage(user.userId, toolId, eventId, fileName)
    return NextResponse.json({ recorded: true, request_id: requestId })
  } catch {
    // Reporting is best-effort; the client fires this after an already completed export.
    return NextResponse.json({ recorded: false, request_id: requestId }, { status: 202 })
  }
}
