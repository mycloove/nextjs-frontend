/**
 * The integration contract for Mr. Markdown — and the one place a connection is
 * turned into the exact shape the browser is allowed to see.
 *
 * This module is deliberately pure and dependency-free (no Prisma, no fetch, no
 * env, no React), so both the server store and the client hook can share one
 * definition and the mapping can be unit-tested with plain objects. It never
 * carries a token: an installation access token exists only inside
 * `github/app.ts` for the lifetime of one server request.
 *
 * The DTOs here are the stable boundary other surfaces depend on. A future
 * provider (GitLab, Notion…) reuses these types; only its own adapter changes.
 */

export const GITHUB_PROVIDER_ID = 'github' as const

export type IntegrationProviderId = typeof GITHUB_PROVIDER_ID

/** Honest connection states the UI renders. Never a fabricated "connected". */
export type GithubConnectionState = 'connected' | 'needs_reauth'

/** One read-only repository the connection may read from. */
export type RepoLinkView = {
  repo_id: string
  repo_full_name: string
  default_branch: string | null
  selected_path: string | null
  /** ISO timestamp of the last successful read, or null if never read. */
  last_read_at: string | null
  /**
   * Repository visibility, read from GitHub for this connection. Null until the
   * server has observed it — never guessed, so the badge is only shown when known.
   */
  visibility: 'public' | 'private' | null
}

/** A connected GitHub installation, safe to render in the browser. */
export type GithubConnectionView = {
  provider: IntegrationProviderId
  installation_id: string
  account_login: string | null
  account_type: string | null
  status: GithubConnectionState
  connected_at: string
  /** The single chosen repo/branch/file, or null while still choosing. */
  repo: RepoLinkView | null
}

/**
 * What the installation is actually allowed to do, read from GitHub at request
 * time (never assumed). `write` is true only when the App's Contents permission
 * is `write`, so the UI can refuse honestly instead of offering a Publish that
 * would fail.
 */
export type GithubCapabilities = { read: boolean; write: boolean }

/** GET /api/integrations/github/connection */
export type GithubStatusResponse = {
  /** Whether the server has GITHUB_APP_* configured. Absent → honest "Soon". */
  configured: boolean
  /** Used to build the install URL; null when not configured. */
  app_slug: string | null
  connection: GithubConnectionView | null
  capabilities: GithubCapabilities
}

/** One repository the installation has been granted, from the GitHub API. */
export type GithubRepoOption = {
  id: string
  full_name: string
  default_branch: string | null
  private: boolean
  description: string | null
}

/** GET /api/integrations/github/repos */
export type GithubReposResponse = {
  repositories: GithubRepoOption[]
  /** True when GitHub had more pages than we read (the picker says so honestly). */
  truncated: boolean
}

/** GET /api/integrations/github/file — the no-lie proof of a real read. */
export type GithubFileResponse = {
  repo_full_name: string
  branch: string
  path: string
  bytes: number
  snippet: string
  truncated: boolean
  read_at: string
  /** Present only when the request asked for the full body (`?full=1`). */
  content?: string
  /** True when `content` was requested and returned. */
  full?: boolean
  /**
   * The blob sha this content was read at. It comes back in the same contents
   * response, so recording a baseline costs no extra GitHub call. Null when
   * GitHub did not report one (never guessed).
   */
  sha?: string | null
}

/**
 * GET /api/integrations/github/check — a cheap, body-free remote probe.
 *
 * The editor records the sha it read a file at (`GithubFileResponse.sha`); before
 * committing, it can ask whether the file has moved on GitHub since. This route
 * reads only the file's metadata (never its body), so the check stays cheap.
 * `changed` is true only when the caller supplied a baseline `sha` that no longer
 * matches the live one — an unknown baseline (no `sha`) is reported as
 * `changed: false` and the live sha is returned so the caller can adopt it.
 */
export type GithubFileCheckResponse = {
  path: string
  branch: string
  sha: string | null
  changed: boolean
  checked_at: string
}

/** One Markdown file found in the connected repository. */
export type GithubRepoFileEntry = { path: string; size: number }

/** GET /api/integrations/github/tree — the repository's Markdown files. */
export type GithubTreeResponse = {
  repo_full_name: string
  branch: string
  files: GithubRepoFileEntry[]
  truncated: boolean
}

export type GithubWriteMode = 'commit' | 'pr'

/**
 * POST /api/integrations/github/write — the result of a publish. The response is
 * derived from what GitHub actually returned (a real commit SHA or a real PR
 * number), never from an assumption that the write succeeded.
 */
export type GithubWriteResponse =
  | { kind: 'commit'; repo_full_name: string; path: string; branch: string; commit_sha: string; commit_url: string; created: boolean }
  | { kind: 'pr'; repo_full_name: string; path: string; branch: string; base_branch: string; pull_number: number; pull_url: string; created: boolean }

/** POST /api/integrations/github/install */
export type GithubInstallResponse = {
  install_url: string
}

/** Machine-readable error codes for the account-family routes. */
export type GithubErrorCode =
  | 'config_missing'
  | 'sign_in_required'
  | 'invalid_request'
  | 'not_connected'
  | 'installation_mismatch'
  | 'github_unauthorized'
  | 'github_forbidden'
  | 'github_not_found'
  | 'github_rate_limited'
  | 'github_unavailable'
  | 'github_conflict'
  | 'write_not_permitted'
  | 'content_required'
  | 'content_too_large'
  | 'branch_not_found'
  | 'repo_required'
  | 'repo_not_found'
  | 'file_not_found'
  | 'store_unavailable'
  | 'rate_limited'
  | 'internal_error'

/* ── Row shapes for mapping ────────────────────────────────────────────────
   Structural (not Prisma types) so the mappers are testable without a
   generated client, and so a store refactor cannot silently change them. */

export type RepoLinkRowLike = {
  repoId: string
  repoFullName: string
  defaultBranch: string | null
  selectedPath: string | null
  lastReadAt: Date | string | null
  /** Not stored: attached by the server when it has observed the repo. */
  visibility?: string | null
}

export type ConnectionRowLike = {
  externalId: string
  accountLogin: string | null
  accountType: string | null
  status: string
  createdAt: Date | string
  links?: RepoLinkRowLike[]
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/**
 * The DB `status` column is free text so it can grow without a migration; any
 * value we do not recognise is reported as `needs_reauth` — the honest, safe
 * default that asks the owner to reconnect rather than claiming a live link.
 */
export function normalizeConnectionStatus(value: string): GithubConnectionState {
  return value === 'connected' ? 'connected' : 'needs_reauth'
}

export function toRepoLinkView(row: RepoLinkRowLike): RepoLinkView {
  return {
    repo_id: row.repoId,
    repo_full_name: row.repoFullName,
    default_branch: row.defaultBranch,
    selected_path: row.selectedPath,
    last_read_at: toIso(row.lastReadAt),
    visibility: row.visibility === 'public' || row.visibility === 'private' ? row.visibility : null,
  }
}

export function toConnectionView(row: ConnectionRowLike): GithubConnectionView {
  return {
    provider: GITHUB_PROVIDER_ID,
    installation_id: row.externalId,
    account_login: row.accountLogin,
    account_type: row.accountType,
    status: normalizeConnectionStatus(row.status),
    connected_at: toIso(row.createdAt) ?? new Date(0).toISOString(),
    repo: row.links?.[0] ? toRepoLinkView(row.links[0]) : null,
  }
}

/** A short, honest snippet limit so a huge README cannot flood the response. */
export const FILE_SNIPPET_MAX_CHARS = 600
export const FILE_READ_MAX_BYTES = 512 * 1024
/** A published document is a document, not a binary blob: cap it explicitly. */
export const FILE_WRITE_MAX_BYTES = 1024 * 1024
/** The file browser lists at most this many Markdown files, and says so. */
export const TREE_MAX_FILES = 500
/** Longest commit message / PR title we accept. */
export const COMMIT_MESSAGE_MAX_CHARS = 200
