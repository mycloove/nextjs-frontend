/**
 * The permission model for the GitHub connection, expressed once so the UI copy
 * and the App's declared permissions cannot drift apart.
 *
 * The connection reads the repositories the owner selects and can publish a
 * document back to one of them, but only as an explicit, confirmed action — a
 * commit or a pull request the owner chooses. The App is installed with "Only
 * select repositories" and Contents: Read & write; there is no access to issues,
 * actions, secrets, email or any other GitHub data, and no silent write path
 * exists anywhere in the code.
 */

export const GITHUB_APP_PERMISSIONS = {
  // `write` on Contents implies read; there is no narrower write scope.
  contents: 'write',
  metadata: 'read',
} as const

export type GithubPermissionScope = keyof typeof GITHUB_APP_PERMISSIONS

/** One honest sentence for the connect card, in the workspace register. */
export const GITHUB_SCOPE_SUMMARY =
  'Read the repositories you choose, and write back only when you confirm each change.'

/**
 * The plain-language list shown in the "why we ask" panel. Each line is what the
 * permission actually grants, not policy language.
 */
export const GITHUB_SCOPE_DETAILS: readonly string[] = [
  'Read files in the repositories you select — README and Markdown documents.',
  'Publish a document back to a repository you select — as a commit or a pull request.',
  'Read repository and branch metadata so a change can be placed safely.',
]

/** The explicit non-goals, stated so trust does not have to be inferred. */
export const GITHUB_SCOPE_NON_GOALS: readonly string[] = [
  'No access to repositories you did not select.',
  'No automatic or silent writes — every publish is confirmed, and conflicts are surfaced.',
  'No access to your email, profile, issues, actions, secrets or any other GitHub data.',
  'No token is stored on the server; access is minted on demand and expires within the hour.',
]

/** Where the owner can review or revoke the installation themselves. */
export const GITHUB_INSTALLATIONS_URL = 'https://github.com/settings/installations'

/** Where the App's own permissions are declared (owner-only page). */
export function githubAppPermissionsUrl(slug: string): string {
  return `https://github.com/settings/apps/${encodeURIComponent(slug)}/permissions`
}

export function githubInstallUrl(slug: string): string {
  return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`
}

/**
 * The single path a fresh connection is allowed to read until the owner chooses
 * another. A caller may pass a different path, but it is normalised through
 * `sanitizeRepoPath` first so it can never be a traversal or an absolute path.
 */
export const DEFAULT_READ_PATH = 'README.md'

/**
 * Normalises a repository file path to a safe relative POSIX path. Returns null
 * for anything that could escape the repository (absolute, drive-lettered, or
 * containing `..`), so the caller refuses rather than passing it to GitHub.
 */
export function sanitizeRepoPath(input: string): string | null {
  const collapsed = input.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  if (!collapsed) return null
  if (collapsed.startsWith('/')) return null
  if (/^[a-zA-Z]:/.test(collapsed)) return null
  const segments = collapsed.split('/')
  if (segments.some((segment) => segment === '..' || segment === '')) return null
  if (collapsed.length > 400) return null
  return segments.join('/')
}

/**
 * Normalises a git branch name. Returns null for anything that is not a plain,
 * safe ref segment set — no leading or trailing slash, no `..`, no characters git
 * forbids in a ref, no spaces — so a client cannot smuggle a weird ref into a ref
 * lookup or a branch create.
 */
export function sanitizeBranchName(input: string): string | null {
  const value = input.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  if (!value || value.length > 200) return null
  if (value.startsWith('/') || value.endsWith('/')) return null
  if (value.endsWith('.') || value.endsWith('.lock')) return null
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return null
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  return value
}

/** Marks the paths the file browser treats as Markdown documents. */
export const MARKDOWN_FILE_PATTERN = /\.(md|markdown|mdx)$/i
