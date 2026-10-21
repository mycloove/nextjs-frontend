import { createSign } from 'node:crypto'
import { FILE_READ_MAX_BYTES, TREE_MAX_FILES, type GithubErrorCode, type GithubRepoFileEntry, type GithubRepoOption } from '../types.ts'
import { MARKDOWN_FILE_PATTERN } from './scopes.ts'

/**
 * The server-only GitHub App client. It is the *only* place a GitHub token
 * exists: a short-lived App JWT is signed from the private key, exchanged for an
 * installation access token, and that token is cached in memory for its ~1h
 * lifetime and never persisted, returned, or logged. The browser only ever sees
 * derived metadata (see `lib/integrations/types.ts`).
 *
 * Configuration is env-only and the whole feature is gated on it: with no
 * `GITHUB_APP_*` values the app is unconfigured and the UI shows an honest
 * "Soon" rather than a Connect button that would do nothing.
 */

const API = 'https://api.github.com'
const API_VERSION = '2022-11-28'
const USER_AGENT = 'smilepdf-mr-markdown'
const JWT_TTL_MS = 9 * 60 * 1000 // GitHub caps App JWTs at 10 minutes.
const REQUEST_TIMEOUT_MS = 12_000
/** Installation tokens are valid ~60 min; re-mint this long before expiry. */
const TOKEN_EXPIRY_MARGIN_MS = 60 * 1000

export class GithubApiError extends Error {
  status: number
  code: GithubErrorCode
  constructor(message: string, status: number, code: GithubErrorCode) {
    super(message)
    this.name = 'GithubApiError'
    this.status = status
    this.code = code
  }
}

export type GithubAppConfig = {
  appId: string
  clientId: string | null
  clientSecret: string | null
  slug: string
  privateKeyPem: string
}

/**
 * Normalises `GITHUB_APP_PRIVATE_KEY`, which may be a literal PEM (multi-line,
 * with escaped `\n`) or a base64 encoding of that PEM — the documented form,
 * because a multi-line secret is awkward to place in a `.env` or Compose value.
 */
function readPrivateKey(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (value.includes('BEGIN')) return value.replace(/\\n/g, '\n')
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8')
    return decoded.includes('BEGIN') ? decoded : null
  } catch {
    return null
  }
}

export function readGithubAppConfig(): GithubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID?.trim()
  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim() || null
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim() || null
  const slug = process.env.GITHUB_APP_SLUG?.trim()
  const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY ? readPrivateKey(process.env.GITHUB_APP_PRIVATE_KEY) : null
  if (!appId || !slug || !privateKeyPem) return null
  return { appId, clientId, clientSecret, slug, privateKeyPem }
}

export function isGithubAppConfigured(): boolean {
  return readGithubAppConfig() !== null
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

/** Signs a short RS256 App JWT. `iss` is the client id (preferred) or app id. */
export function signAppJwt(config: GithubAppConfig, now: number = Date.now()): string {
  const iat = Math.floor(now / 1000)
  const exp = Math.floor((now + JWT_TTL_MS) / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({ iat, exp, iss: config.clientId ?? config.appId }))
  const signingInput = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  signer.end()
  return `${signingInput}.${base64url(signer.sign(config.privateKeyPem))}`
}

function codeForStatus(status: number, headers: Headers): GithubErrorCode {
  if (status === 401) return 'github_unauthorized'
  if (status === 403) {
    return headers.get('x-ratelimit-remaining') === '0' ? 'github_rate_limited' : 'github_forbidden'
  }
  if (status === 404) return 'github_not_found'
  if (status >= 500) return 'github_unavailable'
  return 'github_unavailable'
}

async function githubFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': USER_AGENT,
        ...(init.headers ?? {}),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GithubApiError('GitHub did not respond in time.', 504, 'github_unavailable')
    }
    throw new GithubApiError('GitHub could not be reached.', 502, 'github_unavailable')
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Reads a JSON body, mapping failures to a `GithubApiError`. `conflictStatuses`
 * lets a write call report 409/422 as `github_conflict` (the honest "the branch
 * moved / the file changed" case) instead of a generic upstream failure.
 */
async function readJson<T>(response: Response, conflictStatuses: number[] = []): Promise<T> {
  if (!response.ok) {
    const code: GithubErrorCode = conflictStatuses.includes(response.status)
      ? 'github_conflict'
      : codeForStatus(response.status, response.headers)
    throw new GithubApiError(
      `GitHub returned HTTP ${response.status}.`,
      response.status === 404 ? 404 : response.status,
      code,
    )
  }
  return (await response.json()) as T
}

/* ── Installation tokens ─────────────────────────────────────────────── */

type CachedToken = { token: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>()

/** Test seam: forget cached installation tokens. */
export function resetInstallationTokens(): void {
  tokenCache.clear()
}

type InstallationTokenResponse = { token: string; expires_at: string }

/**
 * Mints (or returns a cached) installation access token. The token is scoped to
 * the installation — i.e. only the repositories the owner granted us — so a
 * request that reaches a repo outside that set is refused by GitHub itself.
 */
export async function getInstallationToken(
  config: GithubAppConfig,
  installationId: string,
  now: number = Date.now(),
): Promise<string> {
  const cached = tokenCache.get(installationId)
  if (cached && cached.expiresAt - TOKEN_EXPIRY_MARGIN_MS > now) return cached.token

  const response = await githubFetch(`${API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${signAppJwt(config, now)}` },
  })
  const body = await readJson<InstallationTokenResponse>(response)
  const expiresAt = Date.parse(body.expires_at)
  tokenCache.set(installationId, {
    token: body.token,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : now + 50 * 60 * 1000,
  })
  return body.token
}

/* ── App endpoints ───────────────────────────────────────────────────── */

type InstallationResponse = {
  id: number
  account: { login?: string; type?: string } | null
  permissions?: Record<string, string> | null
}

export type InstallationInfo = {
  id: string
  accountLogin: string | null
  accountType: string | null
  /** Declared Contents permission for this installation: 'read' | 'write' | null. */
  contentsPermission: 'read' | 'write' | null
}

/**
 * Verifies that an `installation_id` really belongs to *our* App and returns its
 * account identity and declared Contents permission. This is what makes a forged
 * callback harmless: an installation id from a different App, or a made-up one,
 * answers 404 here.
 */
export async function getInstallation(
  config: GithubAppConfig,
  installationId: string,
  now: number = Date.now(),
): Promise<InstallationInfo> {
  const response = await githubFetch(`${API}/app/installations/${encodeURIComponent(installationId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${signAppJwt(config, now)}` },
  })
  const body = await readJson<InstallationResponse>(response)
  const contents = body.permissions?.contents
  return {
    id: String(body.id),
    accountLogin: body.account?.login ?? null,
    accountType: body.account?.type ?? null,
    contentsPermission: contents === 'write' ? 'write' : contents === 'read' ? 'read' : null,
  }
}

type RepositoriesResponse = {
  total_count: number
  repositories: {
    id: number
    full_name: string
    default_branch?: string | null
    private: boolean
    description?: string | null
  }[]
}

/**
 * The repositories the installation has actually been granted. Paginated up to a
 * bounded page count; `truncated` tells the picker to say so honestly rather than
 * silently hiding repositories.
 */
export async function listInstallationRepos(
  config: GithubAppConfig,
  installationId: string,
  now: number = Date.now(),
): Promise<{ repositories: GithubRepoOption[]; truncated: boolean }> {
  const token = await getInstallationToken(config, installationId, now)
  const perPage = 100
  const maxPages = 5
  const repositories: GithubRepoOption[] = []
  let page = 1
  let total = 0

  while (page <= maxPages) {
    const response = await githubFetch(
      `${API}/installation/repositories?per_page=${perPage}&page=${page}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    )
    const body = await readJson<RepositoriesResponse>(response)
    total = body.total_count
    for (const repo of body.repositories) {
      repositories.push({
        id: String(repo.id),
        full_name: repo.full_name,
        default_branch: repo.default_branch ?? null,
        private: Boolean(repo.private),
        description: repo.description ?? null,
      })
    }
    if (body.repositories.length < perPage) break
    page += 1
  }

  return { repositories, truncated: total > repositories.length }
}

/** Confirms the installation can see this exact repo, without reading contents. */
export async function getInstallationRepo(
  config: GithubAppConfig,
  installationId: string,
  repoFullName: string,
  now: number = Date.now(),
): Promise<GithubRepoOption> {
  const token = await getInstallationToken(config, installationId, now)
  const response = await githubFetch(`${API}/repos/${repoFullName}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await readJson<{
    id: number
    full_name: string
    default_branch?: string | null
    private: boolean
    description?: string | null
  }>(response)
  return {
    id: String(body.id),
    full_name: body.full_name,
    default_branch: body.default_branch ?? null,
    private: Boolean(body.private),
    description: body.description ?? null,
  }
}

type ContentsResponse = { type: string; content?: string; encoding?: string; size?: number; name?: string; sha?: string }

export type RepoFile = { content: string; bytes: number; sha: string | null }

/**
 * Reads one file from a granted repository. A directory path, a missing file, or
 * a path outside the installation all surface as `GithubApiError`, which the
 * route maps to an honest error — never a fabricated "connected".
 */
export async function readRepoFile(
  config: GithubAppConfig,
  installationId: string,
  input: { repoFullName: string; path: string; ref?: string | null },
  now: number = Date.now(),
): Promise<RepoFile> {
  const token = await getInstallationToken(config, installationId, now)
  const url = new URL(`${API}/repos/${input.repoFullName}/contents/${input.path}`)
  if (input.ref) url.searchParams.set('ref', input.ref)
  const response = await githubFetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await readJson<ContentsResponse>(response)
  if (body.type !== 'file' || typeof body.content !== 'string') {
    throw new GithubApiError('That path is not a readable file in this repository.', 415, 'file_not_found')
  }
  // Guard before decoding: a multi-hundred-megabyte blob must not be materialised
  // in memory for what is only a verification read.
  if (typeof body.size === 'number' && body.size > FILE_READ_MAX_BYTES) {
    throw new GithubApiError('That file is too large to read for verification.', 413, 'invalid_request')
  }
  const buffer = Buffer.from(body.content.replace(/\n/g, ''), 'base64')
  // The blob sha rides along in the same response, so recording the baseline the
  // caller read at costs no extra GitHub call.
  return { content: buffer.toString('utf8'), bytes: buffer.byteLength, sha: body.sha ?? null }
}

type GitTreeResponse = {
  truncated?: boolean
  tree: { path?: string; type?: string; size?: number }[]
}

/**
 * Lists the Markdown files in a granted repository. The ref is resolved to a
 * commit sha first because the trees endpoint takes a single path segment — a
 * branch like `release/v1` would otherwise be routed wrongly.
 */
export async function listRepoMarkdownFiles(
  config: GithubAppConfig,
  installationId: string,
  input: { repoFullName: string; ref: string },
  now: number = Date.now(),
): Promise<{ files: GithubRepoFileEntry[]; truncated: boolean }> {
  const token = await getInstallationToken(config, installationId, now)
  const sha = await getBranchSha(config, installationId, input.repoFullName, input.ref, now)
  const response = await githubFetch(`${API}/repos/${input.repoFullName}/git/trees/${sha}?recursive=1`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await readJson<GitTreeResponse>(response)
  const files: GithubRepoFileEntry[] = []
  let truncated = Boolean(body.truncated)
  for (const entry of body.tree) {
    if (entry.type !== 'blob' || !entry.path) continue
    if (!MARKDOWN_FILE_PATTERN.test(entry.path)) continue
    if (files.length >= TREE_MAX_FILES) {
      truncated = true
      break
    }
    files.push({ path: entry.path, size: entry.size ?? 0 })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { files, truncated }
}

type GitRefResponse = { object?: { sha?: string } }

/** The commit sha at the tip of a branch, or a `branch_not_found` error. */
export async function getBranchSha(
  config: GithubAppConfig,
  installationId: string,
  repoFullName: string,
  branch: string,
  now: number = Date.now(),
): Promise<string> {
  const token = await getInstallationToken(config, installationId, now)
  const response = await githubFetch(`${API}/repos/${repoFullName}/git/ref/heads/${branch}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (response.status === 404) {
    throw new GithubApiError('That branch no longer exists in this repository.', 404, 'branch_not_found')
  }
  const body = await readJson<GitRefResponse>(response)
  const sha = body.object?.sha
  if (!sha) throw new GithubApiError('GitHub did not report the branch tip.', 502, 'github_unavailable')
  return sha
}

/** Creates a new branch pointing at `fromSha`. An existing ref is a conflict. */
export async function createBranch(
  config: GithubAppConfig,
  installationId: string,
  repoFullName: string,
  branch: string,
  fromSha: string,
  now: number = Date.now(),
): Promise<void> {
  const token = await getInstallationToken(config, installationId, now)
  const response = await githubFetch(`${API}/repos/${repoFullName}/git/refs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
  })
  await readJson<{ ref?: string }>(response, [409, 422])
}

/** The blob sha of a file on a ref, or null when it does not exist there yet. */
export async function getFileSha(
  config: GithubAppConfig,
  installationId: string,
  repoFullName: string,
  path: string,
  ref: string | null,
  now: number = Date.now(),
): Promise<string | null> {
  const token = await getInstallationToken(config, installationId, now)
  const url = new URL(`${API}/repos/${repoFullName}/contents/${path}`)
  if (ref) url.searchParams.set('ref', ref)
  const response = await githubFetch(url.toString(), { method: 'GET', headers: { Authorization: `Bearer ${token}` } })
  if (response.status === 404) return null
  const body = await readJson<ContentsResponse>(response)
  if (body.type !== 'file') return null
  return body.sha ?? null
}

export type RepoWrite = { commitSha: string; commitUrl: string; contentSha: string | null; created: boolean }

/**
 * Creates or updates one file with a single commit. When `sha` is supplied the
 * update is optimistic against that blob version, so a concurrent change is
 * refused by GitHub (409/422 → `github_conflict`) instead of silently
 * overwriting someone else's work.
 */
export async function writeRepoFile(
  config: GithubAppConfig,
  installationId: string,
  input: { repoFullName: string; path: string; content: string; message: string; branch: string; sha?: string | null },
  now: number = Date.now(),
): Promise<RepoWrite> {
  const token = await getInstallationToken(config, installationId, now)
  const payload: Record<string, unknown> = {
    message: input.message,
    content: Buffer.from(input.content, 'utf8').toString('base64'),
    branch: input.branch,
  }
  if (input.sha) payload.sha = input.sha

  const response = await githubFetch(`${API}/repos/${input.repoFullName}/contents/${input.path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const parsed = await readJson<{
    content?: { sha?: string } | null
    commit?: { sha?: string; html_url?: string } | null
  }>(response, [409, 422])

  const commitSha = parsed.commit?.sha
  if (!commitSha) throw new GithubApiError('GitHub accepted the write but returned no commit.', 502, 'github_unavailable')
  return {
    commitSha,
    commitUrl: parsed.commit?.html_url ?? '',
    contentSha: parsed.content?.sha ?? null,
    created: !input.sha,
  }
}

/** Opens a pull request from `head` into `base`. An existing PR is a conflict. */
export async function openPullRequest(
  config: GithubAppConfig,
  installationId: string,
  input: { repoFullName: string; head: string; base: string; title: string; body?: string },
  now: number = Date.now(),
): Promise<{ number: number; url: string }> {
  const token = await getInstallationToken(config, installationId, now)
  const response = await githubFetch(`${API}/repos/${input.repoFullName}/pulls`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: input.title,
      head: input.head,
      base: input.base,
      ...(input.body ? { body: input.body } : {}),
    }),
  })
  const parsed = await readJson<{ number?: number; html_url?: string }>(response, [409, 422])
  if (typeof parsed.number !== 'number') {
    throw new GithubApiError('GitHub did not return a pull request.', 502, 'github_unavailable')
  }
  return { number: parsed.number, url: parsed.html_url ?? '' }
}

/**
 * Best-effort revoke: removes the App installation from the account's GitHub
 * settings. Called on disconnect so the grant does not outlive our records. A
 * failure is surfaced to the caller (which still deletes its own rows and points
 * the owner at the GitHub installations page) rather than thrown as fatal.
 */
export async function revokeInstallation(
  config: GithubAppConfig,
  installationId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const response = await githubFetch(`${API}/app/installations/${encodeURIComponent(installationId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${signAppJwt(config, now)}` },
  })
  return response.ok || response.status === 404
}
