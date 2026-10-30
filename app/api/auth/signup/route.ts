import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { signupAccount, verifyOrigin } from '@/lib/auth/service'
import { authErrorBody, readJsonBody, sameOriginGuard } from '@/lib/auth/http'

/**
 * Custom sign-up (AUTH-INDEPENDENCE plan). Thin route pattern: validate →
 * forward to the service → mapped error codes. The account row IS the failure
 * surface now — no GoTrue, no Supabase SMTP quota — so a signed-up user never
 * fails because an email limiter had a bad hour.
 *
 * Response reports `mail_sent: false` without being an error: the UI tells the
 * user the account is pending verification and the mail can be resent.
 * No authentication cookie is issued until a verified user logs in.
 */
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()

  const guard = sameOriginGuard(request)
  if (guard) return guard

  try {
    const body = await readJsonBody(request)
    const result = await signupAccount({
      body,
      origin: verifyOrigin(request),
    })
    const response = NextResponse.json(
      {
        user: {
          id: result.userId,
          email: result.email,
          email_verified: result.emailVerified,
        },
        mail_sent: result.mailSent,
        mail_reason: result.mailReason ?? null,
      },
      { headers: { 'X-Request-Id': requestId } },
    )
    return response
  } catch (error) {
    return authErrorBody(error, requestId)
  }
}
