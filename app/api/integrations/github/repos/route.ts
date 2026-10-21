import { GithubApiError, getInstallationRepo, listInstallationRepos, readGithubAppConfig } from '@/lib/integrations/github/app'
import { DEFAULT_READ_PATH, sanitizeRepoPath } from '@/lib/integrations/github/scopes'
import { markGithubConnectionNeedsReauth, readGithubConnection, selectGithubRepo } from '@/lib/integrations/store'
import type { GithubReposResponse } from '@/lib/integrations/types'
import { checkRateLimit, houseError, jsonError, jsonOk, requestIdOf, requireSession } from '../_shared'

export const dynamic = 'force-dynamic'

/**
 * GET  /api/integrations/github/repos — the repositories the installation was
 *      actually granted, for the picker. The list comes from the installation
 *      token, so it can only ever contain repos the owner selected at install
 *      time — never the account's full repo set.
 * POST /api/integrations/github/repos — chooses the single repo (and optional
 *      file) Mr. Markdown reads from. The server re-resolves the repo against the
 *      installation before saving, so a client cannot name a repo it does not
 *      have access to.
 */
export async function GET(request: Request) {
  const requestId = requestIdOf(request)

  const session = await requireSession()
  if (!session) return jsonError(requestId, 'Sign in to list repositories.', 'sign_in_required', 401)

  const config = readGithubAppConfig()
  if (!config) return jsonError(requestId, 'GitHub is not configured on this server yet.', 'config_missing', 503)

  const limit = checkRateLimit(session.id, 'repos', 30, 60_000)
  if (!limit.ok) {
    return jsonError(requestId, `Too many repository reads. Try again in ${limit.retryAfterSeconds}s.`, 'rate_limited', 429)
  }

  try {
    const connection = await readGithubConnection(session.id)
    if (!connection) return jsonError(requestId, 'Connect GitHub before choosing a repository.', 'not_connected', 409)

    const { repositories, truncated } = await listInstallationRepos(config, connection.installation_id)
    const body: GithubReposResponse = { repositories, truncated }
    return jsonOk(requestId, body)
  } catch (error) {
    // A 401/404 from GitHub means the installation is gone or revoked: record the
    // honest state before answering, so the UI stops claiming a live connection.
    if (error instanceof GithubApiError && (error.code === 'github_unauthorized' || error.code === 'github_not_found')) {
      await markGithubConnectionNeedsReauth(session.id).catch(() => undefined)
    }
    return houseError(requestId, error)
  }
}

type SelectBody = { repo_full_name?: unknown; selected_path?: unknown }

export async function POST(request: Request) {
  const requestId = requestIdOf(request)

  const session = await requireSession()
  if (!session) return jsonError(requestId, 'Sign in to choose a repository.', 'sign_in_required', 401)

  const config = readGithubAppConfig()
  if (!config) return jsonError(requestId, 'GitHub is not configured on this server yet.', 'config_missing', 503)

  const limit = checkRateLimit(session.id, 'select-repo', 30, 60_000)
  if (!limit.ok) {
    return jsonError(requestId, `Too many changes. Try again in ${limit.retryAfterSeconds}s.`, 'rate_limited', 429)
  }

  let body: SelectBody
  try {
    body = (await request.json()) as SelectBody
  } catch {
    return jsonError(requestId, 'The request body was not JSON.', 'invalid_request', 400)
  }

  const repoFullName = typeof body.repo_full_name === 'string' ? body.repo_full_name.trim() : ''
  if (!repoFullName || !/^[^/\s]+\/[^/\s]+$/.test(repoFullName)) {
    return jsonError(requestId, 'A repository name like owner/name is required.', 'invalid_request', 400)
  }

  const rawPath = typeof body.selected_path === 'string' && body.selected_path.trim() ? body.selected_path : DEFAULT_READ_PATH
  const selectedPath = sanitizeRepoPath(rawPath)
  if (!selectedPath) return jsonError(requestId, 'That file path is not allowed.', 'invalid_request', 400)

  try {
    const connection = await readGithubConnection(session.id)
    if (!connection) return jsonError(requestId, 'Connect GitHub before choosing a repository.', 'not_connected', 409)

    // Re-resolve against the installation: the server, not the client, decides
    // the repo id and default branch, and this 404s if the installation cannot
    // see the repo at all.
    const repo = await getInstallationRepo(config, connection.installation_id, repoFullName)

    const saved = await selectGithubRepo({
      userId: session.id,
      repoId: repo.id,
      repoFullName: repo.full_name,
      defaultBranch: repo.default_branch,
      selectedPath,
      audit: { actorId: session.id, actorEmail: session.email, requestId },
    })
    // The repo visibility was just observed from GitHub above, so the badge is
    // correct on the very first render rather than after a later status read.
    if (saved.repo) saved.repo.visibility = repo.private ? 'private' : 'public'
    return jsonOk(requestId, { connection: saved })
  } catch (error) {
    if (error instanceof GithubApiError && (error.code === 'github_unauthorized' || error.code === 'github_not_found')) {
      await markGithubConnectionNeedsReauth(session.id).catch(() => undefined)
    }
    return houseError(requestId, error)
  }
}
