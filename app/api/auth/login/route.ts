import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { AUTH_COOKIE, AUTH_COOKIE_OPTIONS } from '@/lib/auth/session'
import { loginAccount } from '@/lib/auth/service'
import { authErrorBody, readJsonBody, sameOriginGuard } from '@/lib/auth/http'

/**
 * Email+password sign-in against auth_accounts (custom table). Legacy Google
 * sign-in keeps its Supabase path in LoginClient — that flow stays untouched.
 */
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()

  const guard = sameOriginGuard(request)
  if (guard) return guard

  try {
    const body = await readJsonBody(request)
    const result = await loginAccount({ body, userAgent: request.headers.get('user-agent') })
    const response = NextResponse.json(
      {
        user: {
          id: result.userId,
          email: result.email,
          email_verified: result.emailVerified,
          role: result.role,
          active: result.active,
        },
      },
      { headers: { 'X-Request-Id': requestId } },
    )
    response.cookies.set(AUTH_COOKIE, result.sessionToken, AUTH_COOKIE_OPTIONS)
    return response
  } catch (error) {
    return authErrorBody(error, requestId)
  }
}
