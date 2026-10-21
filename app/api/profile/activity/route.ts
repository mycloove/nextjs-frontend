import { createClient } from '@/lib/supabase/server'
import { listUserActivity } from '@/lib/usage/store'
import { NextResponse } from 'next/server'

/**
 * The signed-in user's own success-only activity, newest first.
 *
 * Scoped strictly to the session's own user id, so one account can never read
 * another's rows. File names are included here and are never exposed on the
 * admin bench (D7).
 */

const DEFAULT_TAKE = 20
const MAX_TAKE = 50

function readPage(request: Request) {
  const url = new URL(request.url)
  const rawTake = Number.parseInt(url.searchParams.get('take') ?? '', 10)
  const rawSkip = Number.parseInt(url.searchParams.get('skip') ?? '', 10)
  const take = Number.isFinite(rawTake) ? Math.min(Math.max(rawTake, 1), MAX_TAKE) : DEFAULT_TAKE
  const skip = Number.isFinite(rawSkip) && rawSkip > 0 ? rawSkip : 0
  return { take, skip }
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  try {
    const page = await listUserActivity(data.user.id, readPage(request))
    return NextResponse.json(page, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    // Activity is a display read, not enforcement, so a missing/unreadable store
    // degrades to an empty page (logged) rather than dead-ending the panel —
    // the same posture the bench's display readers use.
    console.error('Profile activity read degraded', error instanceof Error ? error.message : error)
    return NextResponse.json({ rows: [], total: 0 }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
