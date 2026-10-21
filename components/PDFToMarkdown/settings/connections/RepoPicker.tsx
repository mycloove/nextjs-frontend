'use client'

import type { GithubRepoOption } from '@/lib/integrations/types'
import { DEFAULT_READ_PATH, sanitizeRepoPath } from '@/lib/integrations/github/scopes'
import { useMemo, useState } from 'react'
import ActionButton from './ActionButton'
import InlineLoader from './InlineLoader'
import RepoVisibilityBadge from './RepoVisibilityBadge'

/**
 * The choosing state: one repository, one optional file. Deliberately a radio
 * list, not multi-select — V1 reads from a single place, and presenting an
 * accumulating list would imply a capability that does not exist yet.
 */
export default function RepoPicker({
  repositories,
  truncated,
  loading,
  busy,
  note,
  accountLogin,
  accountType,
  installUrl,
  onConfirm,
  onReload,
}: {
  repositories: GithubRepoOption[]
  truncated: boolean
  loading: boolean
  busy: boolean
  note: string | null
  /** The account the App is installed on — the reason an empty list is empty. */
  accountLogin: string | null
  accountType: string | null
  /** The App's install page, so the owner can install on another account. */
  installUrl: string | null
  onConfirm: (repo: GithubRepoOption, path: string) => void
  onReload: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [path, setPath] = useState(DEFAULT_READ_PATH)

  // The selection is derived, not stored: if the list reloads and the chosen repo
  // is gone (revoked at GitHub), `selected` simply becomes null and the confirm
  // button disables — no effect resetting state needed.
  const selected = useMemo(() => repositories.find((repo) => repo.id === selectedId) ?? null, [repositories, selectedId])
  const pathValid = sanitizeRepoPath(path) !== null
  // An organization's "new repository" page is org-scoped; a user's is not. The
  // empty state must point at the account GitHub is actually filtering by.
  const isOrg = /organization/i.test(accountType ?? '')
  const newRepoUrl = isOrg && accountLogin
    ? `https://github.com/organizations/${encodeURIComponent(accountLogin)}/repositories/new`
    : 'https://github.com/new'

  if (loading) {
    return (
      <article className="mr-cfg-gh-card is-picker is-pending">
        <InlineLoader label="Reading the repositories you granted…" />
      </article>
    )
  }

  return (
    <article className="mr-cfg-gh-card is-picker">
      <div className="mr-cfg-gh-main">
        <div className="mr-cfg-gh-head">
          <strong>Choose one repository</strong>
          <span className="mr-cfg-gh-scope">
            {accountLogin ? <>Installed on <span className="mr-cfg-mono">{accountLogin}</span>. Mr. Markdown reads only what you pick here.</> : 'Mr. Markdown will read only from here.'}
          </span>
        </div>

        {repositories.length === 0 && !note ? (
          <div className="mr-cfg-gh-empty" role="status">
            <p className="mr-cfg-gh-note">
              The App is installed on <strong>{accountLogin ?? 'this account'}</strong>, but GitHub reports
              <strong> no repositories</strong> it can see there. That is exactly why GitHub&apos;s own install page says
              <em> “No repositories found”</em> — the account being filtered has none.
            </p>
            <ul className="mr-cfg-gh-empty-fix">
              <li>Create a repository on <span className="mr-cfg-mono">{accountLogin ?? 'that account'}</span>, or</li>
              <li>install the App on the account that already holds your repositories.</li>
            </ul>
            <div className="mr-cfg-gh-actions">
              <a className="mr-cfg-btn" href={newRepoUrl} target="_blank" rel="noreferrer noopener">
                Create a repository
              </a>
              {installUrl ? (
                <a className="mr-cfg-btn mr-cfg-btn-quiet" href={installUrl} target="_blank" rel="noreferrer noopener">
                  Install on another account
                </a>
              ) : null}
              <ActionButton variant="quiet" disabled={busy} onClick={onReload}>
                Reload list
              </ActionButton>
            </div>
          </div>
        ) : null}
        {repositories.length > 0 ? (
          <ul className="mr-cfg-gh-repos" role="radiogroup" aria-label="Granted repositories">
            {repositories.map((repo) => {
              const active = repo.id === selectedId
              return (
                <li key={repo.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`mr-cfg-gh-repo ${active ? 'is-active' : ''}`}
                    onClick={() => setSelectedId(repo.id)}
                  >
                    <span className="mr-cfg-gh-repo-name">{repo.full_name}</span>
                    <RepoVisibilityBadge visibility={repo.private ? 'private' : 'public'} />
                    {repo.default_branch ? <span className="mr-cfg-gh-repo-branch">{repo.default_branch}</span> : null}
                    {repo.description ? <span className="mr-cfg-gh-repo-desc">{repo.description}</span> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}

        {truncated ? (
          <p className="mr-cfg-gh-fine">More repositories were granted than are shown here; the first 500 are listed.</p>
        ) : null}

        <div className="mr-cfg-gh-field">
          <label className="mr-cfg-gh-field-label" htmlFor="mr-gh-path">
            File to read
          </label>
          <input
            id="mr-gh-path"
            className="mr-cfg-input"
            value={path}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setPath(event.target.value)}
            placeholder={DEFAULT_READ_PATH}
          />
          <span className="mr-cfg-gh-fine">A single Markdown file, relative to the repository root.</span>
        </div>

        <div className="mr-cfg-gh-actions">
          <ActionButton
            variant="primary"
            loading={busy}
            disabled={!selected || !pathValid}
            onClick={() => { if (selected) onConfirm(selected, path.trim() || DEFAULT_READ_PATH) }}
          >
            Use this repository
          </ActionButton>
          <ActionButton variant="quiet" disabled={busy} onClick={onReload}>
            Reload list
          </ActionButton>
        </div>

        {!pathValid ? <p className="mr-cfg-error" role="alert">That file path is not allowed.</p> : null}
        {note ? <p className="mr-cfg-gh-note" role="status">{note}</p> : null}
      </div>
    </article>
  )
}
