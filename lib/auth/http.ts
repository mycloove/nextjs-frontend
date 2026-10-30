import 'server-only'
import { AuthError } from './service'

/**
 * Shared HTTP glue for every app/api/auth route: same JSON envelope the
 * rest of the API answers with ({ error, code, request_id }), plus an origin
 * check on login/signup/logout POSTs. The origin check mirrors
 * validateCreditOrigin in lib/usage/credits.ts — SameSite=Lax already blocks
 * cross-site fetches from carrying our cookie, and this closes the remaining
 * drive-by login POST so nobody can put a victim into *our* session
 * unknowingly.
 */

export type AuthBody<E = unknown> = { ok: true; body: E } | { ok: false; response: Response }

export function sameOriginGuard(request: Request): Response | null {
  const origin = request.headers.get('origin')
  if (!origin) return null // Same-origin form posts and curl omit it here anyway.
  let site = null
  try {
    site = request.headers.get('sec-fetch-site')
  } catch {
    site = null
  }
  if (site === 'cross-site') return refused('cross_site')
  if (origin !== new URL(request.url).origin) return refused('invalid_origin')
  return null
}

function refused(code: string) {
  return Response.json(
    { error: 'This request came from another origin.', code, request_id: null },
    { status: 403 },
  )
}

export function authErrorBody(error: unknown, requestId: string): Response {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message, code: error.code, request_id: requestId }, { status: error.status })
  }
  console.error('Auth route failure', requestId, error)
  return Response.json(
    { error: 'Something went wrong. Please try again.', code: 'auth_internal', request_id: requestId },
    { status: 500 },
  )
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    json = null
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {}
  return json as Record<string, unknown>
}
