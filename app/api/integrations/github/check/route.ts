import { getFileSha, GithubApiError, readGithubAppConfig } from '@/lib/integrations/github/app'
import { sanitizeBranchName, sanitizeRepoPath } from '@/lib/integrations/github/scopes'
import { markGithubConnectionNeedsReauth, readGithubConnection } from '@/lib/integrations/store'
import type { GithubFileCheckResponse } from '@/lib/integrations/types'
import { checkRateLimit, houseError, jsonError, jsonOk, requestIdOf, requireSession } from '../_shared'

export const dynamic = 'force-dynamic'

/**
 * GET /api/integrations/github/check?path=&branch=&sha=
 *
 * A cheap, body-free probe: has the file this document is based on changed on
 * GitHub since it was read? It reads only the file's blob sha (`getFileSha`),
 * never its content — the editor already holds the content, and the point of a
 * remote check is to be cheap enough to run before every commit.
 *
 * Honesty: `changed` is only ever true when the caller supplied a baseline `sha`
 * that no longer matches. With no baseline the route cannot claim a change, so it
 * reports `changed: false` and returns the live sha (which the caller may adopt).
 */
export async function GET(request: Request) {
  const requestId = requestIdOf(request)

  const session = await requireSession()
  if (!session) return jsonError(requestId, 'Sign in to check the repository.', 'sign_in_required', 401)

  const config = readGithubAppConfig()
  if (!config) return jsonError(requestId, 'GitHub is not configured on this server yet.', 'config_missing', 503)

  const limit = checkRateLimit(session.id, 'check', 90, 60_000)
  if (!limit.ok) {
    return jsonError(requestId, `Too many checks. Try again in ${limit.retryAfterSeconds}s.`, 'rate_limited', 429)
  }

  try {
    const connection = await readGithubConnection(session.id)
    if (!connection) return jsonError(requestId, 'Connect GitHub before checking a file.', 'not_connected', 409)

    const url = new URL(request.url)
    const repoFullName = url.searchParams.get('repo')?.trim() || connection.repo?.repo_full_name
    if (!repoFullName) return jsonError(requestId, 'Choose a repository first.', 'repo_required', 409)

    const rawPath = url.searchParams.get('path')?.trim()
    const path = rawPath ? sanitizeRepoPath(rawPath) : null
    if (!path) return jsonError(requestId, 'That file path is not allowed.', 'invalid_request', 400)

    const requestedBranch = url.searchParams.get('branch')?.trim()
    const branch = requestedBranch ? sanitizeBranchName(requestedBranch) : null
    if (requestedBranch && !branch) return jsonError(requestId, 'That branch name is not allowed.', 'invalid_request', 400)
    const ref = branch || connection.repo?.default_branch || null

    const baselineSha = url.searchParams.get('sha')?.trim() || null
    const liveSha = await getFileSha(config, connection.installation_id, repoFullName, path, ref)

    const body: GithubFileCheckResponse = {
      path,
      branch: branch ?? connection.repo?.default_branch ?? 'default',
      sha: liveSha,
      // Only a known, differing baseline is a real change. An unknown baseline
      // (sha absent) can never be reported as changed — that would be a guess.
      changed: baselineSha !== null && baselineSha !== liveSha,
      checked_at: new Date().toISOString(),
    }
    return jsonOk(requestId, body)
  } catch (error) {
    if (error instanceof GithubApiError && (error.code === 'github_unauthorized' || error.code === 'github_forbidden')) {
      await markGithubConnectionNeedsReauth(session.id).catch(() => undefined)
    }
    return houseError(requestId, error)
  }
}
