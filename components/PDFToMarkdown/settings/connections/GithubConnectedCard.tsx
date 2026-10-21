'use client'

import type { GithubConnectionView, GithubFileResponse } from '@/lib/integrations/types'
import ActionButton from './ActionButton'
import InlineLoader from './InlineLoader'
import RepoVisibilityBadge from './RepoVisibilityBadge'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'never'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'never'
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Level 2 of the dock: *what is linked*, in the order the owner needs it.
 *
 *   identity row  → whose GitHub, and whether the link is live
 *   link sheet    → the repository (with its public/private badge), branch, file
 *   read proof    → evidence the link actually returns bytes
 *   actions       → the two non-destructive moves (re-sync, change repository)
 *
 * Disconnect is deliberately absent: it is destructive and lives as the two-step
 * control in the dock bar, so it can never be hit by accident while working here.
 */
export default function GithubConnectedCard({
  connection,
  proof,
  verifying,
  busy,
  note,
  needsReauth,
  onVerify,
  onChangeRepo,
}: {
  connection: GithubConnectionView
  proof: GithubFileResponse | null
  verifying: boolean
  busy: boolean
  note: string | null
  needsReauth: boolean
  onVerify: () => void
  onChangeRepo: () => void
}) {
  const repo = connection.repo
  // The installation account's avatar is public and login-derived, so no extra
  // API call and no stored URL: it cannot go stale.
  const avatarUrl = connection.account_login
    ? `https://avatars.githubusercontent.com/${encodeURIComponent(connection.account_login)}?size=64`
    : null

  return (
    <article className={`mr-cfg-gh-card ${needsReauth ? 'is-amber' : 'is-live'}`}>
      <span className="mr-cfg-gh-tether" aria-hidden="true" />

      <div className="mr-cfg-gh-main">
        <div className="mr-cfg-gh-head">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- GitHub account avatar; a plain <img> avoids coupling next/image to an external host
            <img className="mr-cfg-gh-avatar" src={avatarUrl} alt="" />
          ) : null}
          <strong>{connection.account_login ?? 'GitHub'}</strong>
          {connection.account_type ? <span className="mr-cfg-gh-fine">{connection.account_type}</span> : null}
          <span className={`mr-cfg-gh-seal ${needsReauth ? 'is-amber' : 'is-live'}`}>
            {needsReauth ? 'Needs reconnect' : 'Connected'}
          </span>
        </div>

        <p className="mr-cfg-gh-meta">
          Linked {formatWhen(connection.connected_at)}
          <span aria-hidden="true"> · </span>
          Last read {formatWhen(proof?.read_at ?? repo?.last_read_at ?? null)}
        </p>

        {needsReauth ? (
          <p className="mr-cfg-gh-banner" role="status">
            This installation is no longer usable at GitHub — it was revoked, suspended, or the account lost access.
            Nothing is read or written until you reconnect from the bar above.
          </p>
        ) : null}

        <dl className="mr-cfg-gh-spec">
          <div className="mr-cfg-gh-spec-row">
            <dt>Repository</dt>
            <dd>
              <span className="mr-cfg-mono">{repo?.repo_full_name ?? 'not chosen'}</span>
              <RepoVisibilityBadge visibility={repo?.visibility} />
            </dd>
          </div>
          <div className="mr-cfg-gh-spec-row">
            <dt>Branch</dt>
            <dd className="mr-cfg-mono">{repo?.default_branch ?? 'default'}</dd>
          </div>
          <div className="mr-cfg-gh-spec-row">
            <dt>File</dt>
            <dd className="mr-cfg-mono">{repo?.selected_path ?? 'README.md'}</dd>
          </div>
        </dl>

        {repo ? (
          <div className="mr-cfg-gh-proof">
            <div className="mr-cfg-gh-proof-head">
              <span className="mr-cfg-gh-proof-label">Read proof</span>
              {verifying ? (
                <InlineLoader label="reading…" />
              ) : proof ? (
                <span className="mr-cfg-gh-proof-ok">
                  {formatBytes(proof.bytes)} <span aria-hidden="true">✓</span>
                </span>
              ) : (
                <span className="mr-cfg-gh-fine">not yet read</span>
              )}
            </div>
            {proof ? (
              <>
                <pre className="mr-cfg-gh-proof-body">{proof.snippet}{proof.truncated ? '\n…' : ''}</pre>
                <span className="mr-cfg-gh-fine">From {proof.repo_full_name} · {proof.branch} · {proof.path}</span>
              </>
            ) : (
              <ActionButton variant="quiet" loading={verifying} disabled={busy} onClick={onVerify}>
                Verify read
              </ActionButton>
            )}
          </div>
        ) : (
          <p className="mr-cfg-gh-note">No repository chosen yet.</p>
        )}

        <div className="mr-cfg-gh-actions">
          <ActionButton loading={verifying} busyLabel="Re-syncing" disabled={busy} onClick={onVerify}>
            Re-sync
          </ActionButton>
          <ActionButton disabled={busy || verifying} onClick={onChangeRepo}>
            Change repository
          </ActionButton>
        </div>

        {note ? <p className="mr-cfg-gh-note" role="status">{note}</p> : null}
      </div>
    </article>
  )
}
