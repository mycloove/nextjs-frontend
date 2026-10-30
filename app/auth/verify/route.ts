import { NextResponse } from 'next/server'
import { consumeVerification } from '@/lib/auth/service'
import { AUTH_COOKIE } from '@/lib/auth/session'

/**
 * The target of the link inside the verify email. Consumes the one-time
 * token, then sends the person to /login — where the form already lives and
 * the notice can say what happened. Every failure is the same `?verify=error`
 * landing: probing this URL tells an attacker nothing an expired link would
 * not.
 */
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const { origin } = new URL(request.url)
  const token = new URL(request.url).searchParams.get('token') ?? ''
  const outcome = await consumeVerification(token).catch(() => 'expired' as const)
  const target =
    outcome === 'ok' ? '/login?verified=1' : '/login?verify=error'
  const response = NextResponse.redirect(new URL(target, origin), { status: 302 })
  if (outcome === 'ok') {
    response.cookies.set(AUTH_COOKIE, '', { path: '/', httpOnly: true, maxAge: 0 })
  }
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
