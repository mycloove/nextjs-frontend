import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { currentSessionUser } from '@/lib/auth/current-user'
import { readProfile, UsageStoreMissing } from '@/lib/usage/store'

/**
 * Identity for the browser: the custom session first, the Supabase bridge
 * second (see lib/auth/current-user). Answers with the same profile fields
 * `/api/profile` exposes, so the topbar hook can hydrate from here alone —
 * including avatar/name that live on the users row.
 */
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  const user = await currentSessionUser()
  if (!user) {
    return NextResponse.json({ signed_in: false, user: null }, { headers: { 'X-Request-Id': requestId } })
  }
  try {
    const profile = await readProfile(user.userId)
    return NextResponse.json(
      {
        signed_in: true,
        user: {
          id: user.userId,
          email: user.email,
          email_verified: user.emailVerified,
          role: user.role,
          active: user.active,
          name: profile?.name ?? null,
          avatar_url: profile?.avatar_url ?? null,
        },
      },
      { headers: { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    if (error instanceof UsageStoreMissing) {
      // Store down: still report identity so the nav chip stays, without profile extras.
      return NextResponse.json({
        signed_in: true,
        user: {
          id: user.userId,
          email: user.email,
          email_verified: user.emailVerified,
          role: user.role,
          active: user.active,
          name: null,
          avatar_url: null,
        },
      }, { headers: { 'X-Request-Id': requestId } })
    }
    throw error
  }
}
