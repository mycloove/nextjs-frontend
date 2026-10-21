import { getInstallation, getInstallationRepo, GithubApiError, readGithubAppConfig } from '@/lib/integrations/github/app'
import { markGithubConnectionNeedsReauth, readGithubConnection } from '@/lib/integrations/store'
import type { GithubCapabilities, GithubStatusResponse } from '@/lib/integrations/types'
import { houseError, jsonOk, requestIdOf, requireSession } from '../_shared'

export const dynamic = 'force-dynamic'

const NO_CAPABILITIES: GithubCapabilities = { read: false, write: false }

/**
 * GET /api/integrations/github/connection
 *
 * The one read the Connections section makes on mount: whether the server has
 * the App configured, the caller's own connection (if any), and what the
 * installation is *actually* allowed to do. The capabilities are read from
 * GitHub, never assumed, so the write surface can be refused honestly rather than
 * offering a Publish that would fail.
 *
 * A guest is not an error — the section renders its sign-in gate from the same
 * answer.
 */
export async function GET(request: Request) {
  const requestId = requestIdOf(request)
  const config = readGithubAppConfig()
  const configured = Boolean(config)

  const session = await requireSession()
  if (!session) {
    const body: GithubStatusResponse = { configured, app_slug: config?.slug ?? null, connection: null, capabilities: NO_CAPABILITIES }
    return jsonOk(requestId, body)
  }

  try {
    const connection = await readGithubConnection(session.id)
    let capabilities: GithubCapabilities = { read: Boolean(connection), write: false }

    if (connection && config && connection.status === 'connected') {
      try {
        const installation = await getInstallation(config, connection.installation_id)
        capabilities = { read: true, write: installation.contentsPermission === 'write' }
        // The selected repo's visibility and live default branch are read here so
        // the UI can show a real public/private badge instead of guessing, and so
        // a renamed default branch is corrected on the next status read.
        if (connection.repo) {
          const repo = await getInstallationRepo(config, connection.installation_id, connection.repo.repo_full_name)
          connection.repo.visibility = repo.private ? 'private' : 'public'
          connection.repo.default_branch = repo.default_branch ?? connection.repo.default_branch
        }
      } catch (error) {
        // A revoked/unreadable installation must not dead-end the panel: report
        // read-only and let the connection's own status carry the honest state.
        if (error instanceof GithubApiError && (error.code === 'github_unauthorized' || error.code === 'github_not_found')) {
          await markGithubConnectionNeedsReauth(session.id).catch(() => undefined)
          connection.status = 'needs_reauth'
        } else {
          console.warn('GitHub capabilities could not be read', error instanceof Error ? error.message : error)
        }
      }
    }

    const body: GithubStatusResponse = { configured, app_slug: config?.slug ?? null, connection, capabilities }
    return jsonOk(requestId, body)
  } catch (error) {
    return houseError(requestId, error)
  }
}
