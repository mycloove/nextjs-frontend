import { getInstallation, GithubApiError, readGithubAppConfig } from '@/lib/integrations/github/app'
import { publishRepoFile } from '@/lib/integrations/github/publish'
import { sanitizeBranchName, sanitizeRepoPath } from '@/lib/integrations/github/scopes'
import { markGithubConnectionNeedsReauth, readGithubConnection } from '@/lib/integrations/store'
import {
  COMMIT_MESSAGE_MAX_CHARS,
  FILE_WRITE_MAX_BYTES,
  type GithubWriteMode,
  type GithubWriteResponse,
} from '@/lib/integrations/types'
import { checkRateLimit, houseError, jsonError, jsonOk, requestIdOf, requireSession } from '../_shared'

export const dynamic = 'force-dynamic'

type WriteBody = {
  repo_full_name?: unknown
  path?: unknown
  content?: unknown
  message?: unknown
  branch?: unknown
  mode?: unknown
}

/**
 * POST /api/integrations/github/write
 *
 * Publishes one Markdown document back to a granted repository — as a commit or
 * as a pull request, chosen explicitly by the caller. Every guard is server-side:
 * the path and branch are sanitized, the content is size-capped, the App's write
 * permission is verified with GitHub *before* anything is written, and the result
 * is whatever GitHub actually returned. A read-only App is refused with
 * `write_not_permitted`, never a silent failure.
 */
export async function POST(request: Request) {
  const requestId = requestIdOf(request)

  const session = await requireSession()
  if (!session) return jsonError(requestId, 'Sign in to publish to GitHub.', 'sign_in_required', 401)

  const config = readGithubAppConfig()
  if (!config) return jsonError(requestId, 'GitHub is not configured on this server yet.', 'config_missing', 503)

  const limit = checkRateLimit(session.id, 'write', 20, 60_000)
  if (!limit.ok) {
    return jsonError(requestId, `Too many publish attempts. Try again in ${limit.retryAfterSeconds}s.`, 'rate_limited', 429)
  }

  let body: WriteBody
  try {
    body = (await request.json()) as WriteBody
  } catch {
    return jsonError(requestId, 'The request body was not JSON.', 'invalid_request', 400)
  }

  const path = typeof body.path === 'string' ? sanitizeRepoPath(body.path) : null
  if (!path) return jsonError(requestId, 'A repository-relative file path is required.', 'invalid_request', 400)

  const content = typeof body.content === 'string' ? body.content : ''
  if (!content.trim()) return jsonError(requestId, 'There is nothing to publish yet.', 'content_required', 400)
  if (Buffer.byteLength(content, 'utf8') > FILE_WRITE_MAX_BYTES) {
    return jsonError(requestId, 'That document is too large to publish (limit 1 MB).', 'content_too_large', 413)
  }

  const mode: GithubWriteMode = body.mode === 'pr' ? 'pr' : 'commit'
  const message = (typeof body.message === 'string' && body.message.trim()
    ? body.message.trim()
    : `Update ${path}`).slice(0, COMMIT_MESSAGE_MAX_CHARS)

  try {
    const connection = await readGithubConnection(session.id)
    if (!connection) return jsonError(requestId, 'Connect GitHub before publishing.', 'not_connected', 409)

    const repoFullName = (typeof body.repo_full_name === 'string' && body.repo_full_name.trim()) || connection.repo?.repo_full_name
    if (!repoFullName) return jsonError(requestId, 'Choose a repository first.', 'repo_required', 409)

    const requestedBranch = typeof body.branch === 'string' ? body.branch : ''
    const branch = requestedBranch.trim()
      ? sanitizeBranchName(requestedBranch)
      : connection.repo?.default_branch ?? null
    if (!branch) return jsonError(requestId, 'A valid target branch is required.', 'invalid_request', 400)

    // Verify write permission against GitHub before attempting the write, so a
    // read-only App gets a clear, actionable refusal instead of a raw 403.
    const installation = await getInstallation(config, connection.installation_id)
    if (installation.contentsPermission !== 'write') {
      return jsonError(
        requestId,
        'This GitHub App has read-only access. Set its Contents permission to Read & write on GitHub, then reconnect.',
        'write_not_permitted',
        403,
      )
    }

    const result: GithubWriteResponse = await publishRepoFile(config, connection.installation_id, {
      repoFullName,
      path,
      content,
      message,
      branch,
      mode,
    })
    return jsonOk(requestId, result)
  } catch (error) {
    if (error instanceof GithubApiError && (error.code === 'github_unauthorized' || error.code === 'github_forbidden')) {
      await markGithubConnectionNeedsReauth(session.id).catch(() => undefined)
    }
    return houseError(requestId, error)
  }
}
