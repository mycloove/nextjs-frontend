import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { AUTH_COOKIE } from '@/lib/auth/session'
import { logout, readCookieToken } from '@/lib/auth/service'

/**
 * Logout for the custom session: delete the DB row, clear the cookie. The
 * client ALSO calls supabase signOut (ProfileMenu keeps both) because a
 * browser can hold either identity system.
 */
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  try {
    await logout(readCookieToken(request))
  } catch (error) {
    // A logout must never fail loudly: clear the cookie regardless.
    console.error('Auth logout failure', { requestId, error: error instanceof Error ? error.message : error })
  }
  const response = NextResponse.json({ ok: true }, { headers: { 'X-Request-Id': requestId } })
  response.cookies.set(AUTH_COOKIE, '', { path: '/', httpOnly: true, maxAge: 0 })
  return response
}
