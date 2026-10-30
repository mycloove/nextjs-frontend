import { currentSessionUser } from '@/lib/auth/current-user'
import { NextResponse } from 'next/server'

/**
 * Own-role read for the signed-in identity. lib/auth/current-user is the one
 * identity reader now: the custom account session first, the Supabase
 * (Google/legacy) bridge second. ensureProfileRecord + status stay inside it,
 * so both systems answer with the same shape.
 */
export async function GET() {
  const user = await currentSessionUser()
  if (!user) return NextResponse.json({ role: null }, { status: 401 })

  return NextResponse.json({ role: user.role, active: user.active })
}
