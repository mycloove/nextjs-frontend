import { readGithubAppConfig, revokeInstallation } from '@/lib/integrations/github/app'
import { GITHUB_INSTALLATIONS_URL } from '@/lib/integrations/github/scopes'
import { deleteGithubConnection, readGithubConnection } from '@/lib/integrations/store'
import { checkRateLimit, houseError, jsonError, jsonOk, requestIdOf, requireSession } from '../_shared'

export const dynamic = 'force-dynamic'

/**
 * POST /api/integrations/github/disconnect
 *
 * Revokes the installation on GitHub (best effort) and deletes our rows. Even if
 * GitHub is unreachable the local records are removed — the grant can never be
 * silently kept alive — and the response says whether the remote revoke
 * succeeded so the UI can point at the GitHub installations page when it did not.
 */
export async function POST(request: Request) {
  const requestId = requestIdOf(request)

  const session = await requireSession()
  if (!session) return jsonError(requestId, 'Sign in to disconnect GitHub.', 'sign_in_required', 401)

  const limit = checkRateLimit(session.id, 'disconnect', 10, 60_000)
  if (!limit.ok) {
    return jsonError(requestId, `Too many attempts. Try again in ${limit.retryAfterSeconds}s.`, 'rate_limited', 429)
  }

  try {
    const connection = await readGithubConnection(session.id)
    if (!connection) {
      return jsonOk(requestId, { removed: false, revoked: false, uninstall_url: GITHUB_INSTALLATIONS_URL })
    }

    let revoked = false
    const config = readGithubAppConfig()
    if (config) {
      try {
        revoked = await revokeInstallation(config, connection.installation_id)
      } catch (error) {
        console.warn('GitHub installation revoke failed; removing local records anyway.', error instanceof Error ? error.message : error)
      }
    }

    await deleteGithubConnection(session.id, { actorId: session.id, actorEmail: session.email, requestId })
    return jsonOk(requestId, { removed: true, revoked, uninstall_url: GITHUB_INSTALLATIONS_URL })
  } catch (error) {
    return houseError(requestId, error)
  }
}
