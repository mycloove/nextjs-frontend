import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { resendVerification, verifyOrigin } from '@/lib/auth/service'
import { authErrorBody, readJsonBody, sameOriginGuard } from '@/lib/auth/http'

/**
 * Re-sends the signup verify mail. Always ok:true for an unknown or verified
 * address (enumeration-safe); the service enforces a 60s quiet period so the
 * free Brevo quota cannot be drained from one form.
 */
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()

  const guard = sameOriginGuard(request)
  if (guard) return guard

  try {
    const body = await readJsonBody(request)
    const result = await resendVerification({ body, origin: verifyOrigin(request) })
    return NextResponse.json(result, { headers: { 'X-Request-Id': requestId } })
  } catch (error) {
    return authErrorBody(error, requestId)
  }
}
