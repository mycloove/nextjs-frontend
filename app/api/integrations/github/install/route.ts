import { readGithubAppConfig } from '@/lib/integrations/github/app'
import { githubInstallUrl } from '@/lib/integrations/github/scopes'
import { createPendingState, PENDING_STATE_COOKIE, pendingCookieOptions } from '@/lib/integrations/github/state'
import type { GithubInstallResponse } from '@/lib/integrations/types'
import { checkRateLimit, jsonError, jsonOk, requestIdOf, requireSession } from '../_shared'

export const dynamic = 'force-dynamic'

/**
 * POST /api/integrations/github/install
 *
 * Starts the connect flow: mints the cookie-bound CSRF nonce and returns the
 * GitHub App install URL. The client opens that URL; GitHub then redirects the
 * browser to `/callback`, which verifies the nonce before binding anything.
 */
export async function POST(request: Request) {
  const requestId = requestIdOf(request)

  const session = await requireSession()
  if (!session) return jsonError(requestId, 'Sign in to connect GitHub.', 'sign_in_required', 401)

  const config = readGithubAppConfig()
  // The client secret doubles as the nonce signing key, so the flow genuinely
  // needs it — report the honest configuration state rather than failing later.
  if (!config || !config.clientSecret) {
    return jsonError(requestId, 'GitHub is not configured on this server yet.', 'config_missing', 503)
  }

  const limit = checkRateLimit(session.id, 'install', 10, 60_000)
  if (!limit.ok) {
    return jsonError(requestId, `Too many connect attempts. Try again in ${limit.retryAfterSeconds}s.`, 'rate_limited', 429)
  }

  const body: GithubInstallResponse = { install_url: githubInstallUrl(config.slug) }
  const response = jsonOk(requestId, body)
  response.cookies.set(PENDING_STATE_COOKIE, createPendingState(config.clientSecret), pendingCookieOptions())
  return response
}
