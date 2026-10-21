import { GithubApiError, readGithubAppConfig, readRepoFile } from '@/lib/integrations/github/app'
import { DEFAULT_READ_PATH, sanitizeRepoPath } from '@/lib/integrations/github/scopes'
import { markGithubConnectionNeedsReauth, readGithubConnection, touchGithubRead } from '@/lib/integrations/store'
import { FILE_SNIPPET_MAX_CHARS, type GithubFileResponse } from '@/lib/integrations/types'
import { checkRateLimit, houseError, jsonError, jsonOk, requestIdOf, requireSession } from '../_shared'

export const dynamic = 'force-dynamic'

/**
 * GET /api/integrations/github/file?repo=&branch=&path=
 *
 * The no-lie proof: reads the selected file for real and returns a snippet and
 * its true size, so the connected card can state "read from owner/repo · branch ·
 * 2.1 KB ✓" instead of assuming success. A failure is an honest error — the UI
 * never shows "connected" on top of a read that did not happen.
 */
export async function GET(request: Request) {
  const requestId = requestIdOf(request)

  const session = await requireSession()
  if (!session) return jsonError(requestId, 'Sign in to read from GitHub.', 'sign_in_required', 401)

  const config = readGithubAppConfig()
  if (!config) return jsonError(requestId, 'GitHub is not configured on this server yet.', 'config_missing', 503)

  const limit = checkRateLimit(session.id, 'file', 60, 60_000)
  if (!limit.ok) {
    return jsonError(requestId, `Too many reads. Try again in ${limit.retryAfterSeconds}s.`, 'rate_limited', 429)
  }

  try {
    const connection = await readGithubConnection(session.id)
    if (!connection) return jsonError(requestId, 'Connect GitHub before reading a file.', 'not_connected', 409)

    const url = new URL(request.url)
    const requestedRepo = url.searchParams.get('repo')?.trim()
    const repoFullName = requestedRepo || connection.repo?.repo_full_name
    if (!repoFullName) return jsonError(requestId, 'Choose a repository first.', 'repo_required', 409)

    const rawPath = url.searchParams.get('path')?.trim() || connection.repo?.selected_path || DEFAULT_READ_PATH
    const path = sanitizeRepoPath(rawPath)
    if (!path) return jsonError(requestId, 'That file path is not allowed.', 'invalid_request', 400)

    const requestedBranch = url.searchParams.get('branch')?.trim()
    const ref = requestedBranch || connection.repo?.default_branch || null

    const { content, bytes, sha } = await readRepoFile(config, connection.installation_id, { repoFullName, path, ref })

    const truncated = content.length > FILE_SNIPPET_MAX_CHARS
    const full = url.searchParams.get('full') === '1' || url.searchParams.get('full') === 'true'
    const body: GithubFileResponse = {
      repo_full_name: repoFullName,
      branch: requestedBranch || connection.repo?.default_branch || 'default',
      path,
      bytes,
      snippet: truncated ? content.slice(0, FILE_SNIPPET_MAX_CHARS) : content,
      truncated,
      read_at: new Date().toISOString(),
      // The blob sha is part of the read itself, so the client can remember the
      // exact version it is editing against for a later conflict check.
      sha,
      // The editor needs the whole document; the verification read does not. The
      // body is already capped by `readRepoFile`, so this cannot be unbounded.
      ...(full ? { content, full: true } : {}),
    }

    if (connection.repo && connection.repo.repo_full_name === repoFullName) {
      await touchGithubRead(session.id, connection.repo.repo_id).catch(() => undefined)
    }
    return jsonOk(requestId, body)
  } catch (error) {
    // Only an auth failure means the installation itself is gone; a 404 here is
    // just a wrong path, so it must not flip the connection to needs_reauth.
    if (error instanceof GithubApiError && (error.code === 'github_unauthorized' || error.code === 'github_forbidden')) {
      await markGithubConnectionNeedsReauth(session.id).catch(() => undefined)
    }
    return houseError(requestId, error)
  }
}
