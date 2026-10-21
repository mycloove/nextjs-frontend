import { AiConfigError } from '@/lib/ai/crypto'
import { GithubApiError } from '@/lib/integrations/github/app'
import { IntegrationNotConnected, IntegrationStoreMissing } from '@/lib/integrations/store'
import type { GithubErrorCode } from '@/lib/integrations/types'
import { createClient } from '@/lib/supabase/server'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'

/**
 * Shared plumbing for the GitHub integration routes.
 *
 * These are account-family routes (CLAUDE.md §5): session-gated, JSON, `no-store`,
 * and the house error contract `{ error, code, request_id }` with an
 * `X-Request-Id` header. Unlike the converter routes they do not touch the Flask
 * microservice at all — GitHub is reached server-to-server by
 * `lib/integrations/github/app.ts`, and the browser never sees a token.
 */

export const GITHUB_ROUTE_BASE = '/api/integrations/github'

export type SessionUser = { id: string; email: string | null }

/** Resolves the signed-in account, or null. Never throws for an absent session. */
export async function requireSession(): Promise<SessionUser | null> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  const user = data.user
  return user ? { id: user.id, email: user.email ?? null } : null
}

export function requestIdOf(request: Request): string {
  return request.headers.get('x-request-id')?.trim() || randomUUID()
}

export function noStore(requestId: string): Record<string, string> {
  return { 'Cache-Control': 'no-store', 'X-Request-Id': requestId }
}

export function jsonError(requestId: string, message: string, code: GithubErrorCode, status: number) {
  return NextResponse.json({ error: message, code, request_id: requestId }, { status, headers: noStore(requestId) })
}

export function jsonOk<T>(requestId: string, body: T, status = 200) {
  return NextResponse.json(body, { status, headers: noStore(requestId) })
}

function statusForGithubError(error: GithubApiError): number {
  switch (error.code) {
    case 'github_rate_limited':
      return 429
    case 'github_conflict':
      return 409
    case 'write_not_permitted':
      return 403
    case 'content_required':
      return 400
    case 'content_too_large':
      return 413
    case 'invalid_request':
      return 400
    case 'branch_not_found':
    case 'repo_not_found':
    case 'file_not_found':
    case 'github_not_found':
      return 404
    case 'github_unauthorized':
    case 'github_forbidden':
      return 409
    case 'github_unavailable':
      return error.status === 504 ? 504 : 502
    default:
      return 502
  }
}

/**
 * Maps any failure to the house error contract. A GitHub 401/404 is reported as
 * a conflict (the installation is no longer usable), never as a 401 — that would
 * be indistinguishable from a missing sign-in session.
 */
export function houseError(requestId: string, error: unknown) {
  if (error instanceof GithubApiError) {
    return jsonError(requestId, error.message, error.code, statusForGithubError(error))
  }
  if (error instanceof IntegrationNotConnected) {
    return jsonError(requestId, error.message, 'not_connected', 409)
  }
  if (error instanceof IntegrationStoreMissing) {
    return jsonError(requestId, error.message, 'store_unavailable', 503)
  }
  if (error instanceof AiConfigError) {
    return jsonError(requestId, error.message, 'store_unavailable', 503)
  }
  console.error('GitHub integration route failed', { requestId, error })
  return jsonError(requestId, 'The GitHub connection could not be completed.', 'internal_error', 500)
}

/* ── Modest per-account rate limiting ─────────────────────────────────────
   In-memory and per-process. This exists to stop a stuck client from hammering
   GitHub (and our App's rate budget), not as a security boundary; a restart
   simply clears the window. */

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number }

export function checkRateLimit(
  userId: string,
  action: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const key = `${userId}:${action}`
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true }
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) }
  }
  bucket.count += 1
  return { ok: true }
}

/** Test seam: clear the in-memory rate-limit buckets. */
export function resetRateLimits(): void {
  buckets.clear()
}
