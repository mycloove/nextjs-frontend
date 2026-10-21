import { GithubApiError, getInstallationRepo, listRepoMarkdownFiles, readGithubAppConfig } from '@/lib/integrations/github/app'
import { sanitizeBranchName } from '@/lib/integrations/github/scopes'
import { markGithubConnectionNeedsReauth, readGithubConnection } from '@/lib/integrations/store'
import type { GithubTreeResponse } from '@/lib/integrations/types'
import { checkRateLimit, houseError, jsonError, jsonOk, requestIdOf, requireSession } from '../_shared'

export const dynamic = 'force-dynamic'

/**
 * GET /api/integrations/github/tree?repo=&branch=
 *
 * The Markdown files in the connected repository, so the owner can read any of
 * them rather than only the one path chosen at connect time. The listing is
 * scoped to the installation token, so it can never show a repository outside the
 * grant, and it is bounded — `truncated` says so honestly when more exist.
 */
export async function GET(request: Request) {
  const requestId = requestIdOf(request)

  const session = await requireSession()
  if (!session) return jsonError(requestId, 'Sign in to browse the repository.', 'sign_in_required', 401)

  const config = readGithubAppConfig()
  if (!config) return jsonError(requestId, 'GitHub is not configured on this server yet.', 'config_missing', 503)

  const limit = checkRateLimit(session.id, 'tree', 40, 60_000)
  if (!limit.ok) {
    return jsonError(requestId, `Too many repository reads. Try again in ${limit.retryAfterSeconds}s.`, 'rate_limited', 429)
  }

  try {
    const connection = await readGithubConnection(session.id)
    if (!connection) return jsonError(requestId, 'Connect GitHub before browsing files.', 'not_connected', 409)

    const url = new URL(request.url)
    const repoFullName = url.searchParams.get('repo')?.trim() || connection.repo?.repo_full_name
    if (!repoFullName) return jsonError(requestId, 'Choose a repository first.', 'repo_required', 409)

    const requestedBranch = url.searchParams.get('branch')?.trim()
    let branch = requestedBranch ? sanitizeBranchName(requestedBranch) : connection.repo?.default_branch ?? null
    if (requestedBranch && !branch) {
      return jsonError(requestId, 'That branch name is not allowed.', 'invalid_request', 400)
    }
    if (!branch) {
      branch = (await getInstallationRepo(config, connection.installation_id, repoFullName)).default_branch
    }
    if (!branch) return jsonError(requestId, 'This repository reports no default branch.', 'branch_not_found', 404)

    const { files, truncated } = await listRepoMarkdownFiles(config, connection.installation_id, { repoFullName, ref: branch })
    const body: GithubTreeResponse = { repo_full_name: repoFullName, branch, files, truncated }
    return jsonOk(requestId, body)
  } catch (error) {
    if (error instanceof GithubApiError && (error.code === 'github_unauthorized' || error.code === 'github_forbidden')) {
      await markGithubConnectionNeedsReauth(session.id).catch(() => undefined)
    }
    return houseError(requestId, error)
  }
}
