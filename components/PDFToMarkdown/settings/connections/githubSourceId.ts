/**
 * The provenance key for a document that came from a GitHub file.
 *
 * A document opened from a repository carries one stable identity — which
 * repository, which branch, which path — so the workspace can recognise it
 * again: a second "Open in Mr. Markdown" on the same file focuses the document
 * already open instead of cloning it, and the commit path knows exactly where a
 * baseline was read from. The key is persisted in the session, so its grammar
 * must never change without a migration.
 *
 * Grammar: `github:<owner>/<repo>@<branch>:<path>`
 *  - `owner/repo` may contain `/` (it is a full name);
 *  - `branch` may contain `/` (e.g. `release/v1`) but never `:` (git forbids it),
 *    so the first `:` after the `@` is the branch/path boundary;
 *  - `path` is everything after that `:` and may itself contain `/`.
 *
 * Both helpers are pure and total: `parse` returns `null` for anything that is
 * not a complete, well-formed key — it never throws, so a stray `sourceId` from
 * a future format can only make the reader skip, not crash.
 */

export type GithubSourceIdParts = {
  repoFullName: string
  branch: string
  path: string
}

const GITHUB_SOURCE_PREFIX = 'github:'

export function buildGithubSourceId(repoFullName: string, branch: string, path: string): string {
  return `${GITHUB_SOURCE_PREFIX}${repoFullName}@${branch}:${path}`
}

export function parseGithubSourceId(sourceId: string | null | undefined): GithubSourceIdParts | null {
  if (!sourceId || !sourceId.startsWith(GITHUB_SOURCE_PREFIX)) return null
  const body = sourceId.slice(GITHUB_SOURCE_PREFIX.length)

  const at = body.indexOf('@')
  if (at <= 0) return null
  const repoFullName = body.slice(0, at)

  const rest = body.slice(at + 1)
  const colon = rest.indexOf(':')
  if (colon <= 0) return null
  const branch = rest.slice(0, colon)
  const path = rest.slice(colon + 1)

  if (!repoFullName || !branch || !path) return null
  return { repoFullName, branch, path }
}
