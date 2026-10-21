import type { GithubWriteMode, GithubWriteResponse } from '../types.ts'
import {
  createBranch,
  getBranchSha,
  getFileSha,
  GithubApiError,
  openPullRequest,
  writeRepoFile,
  type GithubAppConfig,
} from './app.ts'

/**
 * Publishing a document back to a repository.
 *
 * Two deliberate modes, both explicit and both confirmed by the owner before a
 * single byte leaves the server:
 *  - `commit` — one commit directly onto the chosen branch; the write is
 *    optimistic against the file's current blob sha, so a concurrent change is
 *    refused (`github_conflict`) instead of overwritten.
 *  - `pr` — a fresh branch from the branch tip, the file written onto it, and a
 *    pull request opened, so nothing lands on the branch without review.
 *
 * The result always reflects what GitHub actually returned (a commit sha or a PR
 * number); the module never reports a write it did not observe.
 */

/** A safe, collision-resistant branch name for a proposed change. */
export function branchNameFor(path: string, now: Date, nonce: string): string {
  const segments = path.split('/').filter(Boolean)
  const file = segments[segments.length - 1] ?? 'document'
  const stem = file.replace(/\.[^.]+$/, '')
  const slug = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'document'
  const iso = now.toISOString()
  const stamp = `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`
  const suffix = nonce.replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'x'
  return `mycloove/${slug}-${stamp}-${suffix}`
}

export type PublishInput = {
  repoFullName: string
  path: string
  content: string
  message: string
  /** The base branch: the commit target, or the PR's base. */
  branch: string
  mode: GithubWriteMode
  nonce?: string
  now?: Date
}

export async function publishRepoFile(
  config: GithubAppConfig,
  installationId: string,
  input: PublishInput,
): Promise<GithubWriteResponse> {
  const now = input.now ?? new Date()
  const { repoFullName, path, content, message } = input

  try {
    if (input.mode === 'commit') {
      const sha = await getFileSha(config, installationId, repoFullName, path, input.branch)
      const write = await writeRepoFile(config, installationId, {
        repoFullName,
        path,
        content,
        message,
        branch: input.branch,
        sha,
      })
      return {
        kind: 'commit',
        repo_full_name: repoFullName,
        path,
        branch: input.branch,
        commit_sha: write.commitSha,
        commit_url: write.commitUrl,
        created: write.created,
      }
    }

    const baseSha = await getBranchSha(config, installationId, repoFullName, input.branch)
    const head = branchNameFor(path, now, input.nonce ?? Math.random().toString(16).slice(2))
    await createBranch(config, installationId, repoFullName, head, baseSha)
    const existing = await getFileSha(config, installationId, repoFullName, path, head)
    await writeRepoFile(config, installationId, {
      repoFullName,
      path,
      content,
      message,
      branch: head,
      sha: existing,
    })
    const pull = await openPullRequest(config, installationId, {
      repoFullName,
      head,
      base: input.branch,
      title: message,
      body: `Proposed by Mr. Markdown.\n\nUpdates \`${path}\`.`,
    })
    return {
      kind: 'pr',
      repo_full_name: repoFullName,
      path,
      branch: head,
      base_branch: input.branch,
      pull_number: pull.number,
      pull_url: pull.url,
      created: !existing,
    }
  } catch (error) {
    // A 403 on a write means the App's Contents permission is still read-only; say
    // that plainly rather than reporting an anonymous GitHub failure.
    if (error instanceof GithubApiError && error.code === 'github_forbidden') {
      throw new GithubApiError(
        'This GitHub App does not have write access. Set its Contents permission to Read & write, then reconnect.',
        error.status,
        'write_not_permitted',
      )
    }
    throw error
  }
}
