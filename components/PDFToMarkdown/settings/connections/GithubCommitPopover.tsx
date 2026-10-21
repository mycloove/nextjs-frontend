'use client'

import { githubAppPermissionsUrl } from '@/lib/integrations/github/scopes'
import type { GithubWriteMode } from '@/lib/integrations/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SourcedDocument } from '../settingsContext'
import { Segmented } from '../sections/parts'
import ActionButton from './ActionButton'
import InlineLoader from './InlineLoader'
import RepoVisibilityBadge from './RepoVisibilityBadge'
import StatusNotice from './StatusNotice'
import { useGithubConnectionContext } from './GithubConnectionProvider'
import { diffLines, isDiffTooLarge, summariseDiff, type DiffLine } from './markdownLineDiff'

/**
 * The editor's commit fast path.
 *
 * Opened from the filename chip on a document that is bound to a GitHub file, so
 * an owner can review and commit without leaving the editor. It is not a second
 * publisher: it shares the one `GithubConnectionProvider` instance and calls the
 * same `gh.publish`, and the diff it shows is the same `markdownLineDiff` the
 * write panel uses. The target is fixed (the document's own repo/branch/path) —
 * the point here is speed, while the panel remains the place to browse and choose
 * a different file.
 *
 * It is honest in the same ways the panel is: the commit control is disabled when
 * there is nothing to commit, a read-only App shows the refusal and the exact page
 * to fix it, and a project's own remote drift is surfaced before a commit rather
 * than discovered as a conflict afterwards.
 */

const POPOVER_VIEWS = [
  { id: 'current' as const, label: 'Current' },
  { id: 'compare' as const, label: 'Compare' },
]

/** Above this many rendered rows the view truncates and says so (never a freeze). */
const DIFF_RENDER_MAX_ROWS = 1200

export default function GithubCommitPopover({
  doc,
  onClose,
  onManageInConnections,
  onResetFromRemote,
}: {
  doc: SourcedDocument
  onClose: () => void
  onManageInConnections: () => void
  onResetFromRemote: (markdown: string, sha: string | null) => void
}) {
  const gh = useGithubConnectionContext()
  const [view, setView] = useState<'current' | 'compare'>('current')
  const [message, setMessage] = useState('')
  const [mode, setMode] = useState<GithubWriteMode>('commit')
  const [confirmingReRead, setConfirmingReRead] = useState(false)
  const [reReading, setReReading] = useState(false)

  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  // Focus the dialog on open and hand focus back to the chip on close — the same
  // convention the console and the remove dialog already follow.
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null
    const timer = window.setTimeout(() => dialogRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(timer)
      restoreRef.current?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // One metadata-only check when the popover opens, so a stale document is
  // flagged before the owner commits. A failure is silent: the commit path's own
  // conflict guard is the real safety net.
  const checkRemote = gh.checkRemote
  const baseSha = doc.baseSha
  useEffect(() => {
    if (!baseSha) return
    checkRemote({ path: doc.path, branch: doc.branch, sha: baseSha })
  }, [checkRemote, baseSha, doc.path, doc.branch])

  const remoteCheck = gh.remoteCheck
  const remoteChanged = Boolean(
    remoteCheck
    && remoteCheck.path === doc.path
    && remoteCheck.branch === doc.branch
    && remoteCheck.changed
    && remoteCheck.baselineSha === doc.baseSha,
  )

  const dirty = doc.dirty
  const canCommit = gh.capabilities.write && dirty && doc.markdown.trim().length > 0

  const rows = useMemo(() => diffLines(doc.baseMarkdown, doc.markdown), [doc.baseMarkdown, doc.markdown])
  const summary = useMemo(() => summariseDiff(doc.baseMarkdown, doc.markdown), [doc.baseMarkdown, doc.markdown])
  const coarse = useMemo(() => isDiffTooLarge(doc.baseMarkdown, doc.markdown), [doc.baseMarkdown, doc.markdown])

  const submit = (nextMode: GithubWriteMode = mode) => {
    gh.publish({
      repoFullName: doc.repoFullName,
      path: doc.path,
      content: doc.markdown,
      message: message.trim(),
      branch: doc.branch,
      mode: nextMode,
    })
  }

  const reRead = useCallback(() => {
    setReReading(true)
    gh.pullFile(doc.path).then((file) => {
      setReReading(false)
      if (!file || typeof file.content !== 'string') return
      onResetFromRemote(file.content, file.sha ?? null)
      setConfirmingReRead(false)
      gh.clearRemoteCheck()
    })
  }, [gh, doc.path, onResetFromRemote])

  return (
    <div className="mr-cfg-gh-pop-overlay" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="mr-cfg-gh-pop"
        role="dialog"
        aria-modal="true"
        aria-label="Commit changes to GitHub"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mr-cfg-gh-pop-head">
          <div>
            <span className="mr-cfg-gh-pop-eyebrow">GitHub</span>
            <strong>{mode === 'pr' ? 'Propose a pull request' : 'Commit changes'}</strong>
          </div>
          <button type="button" className="mr-cfg-gh-pop-close" onClick={onClose} aria-label="Close commit panel">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="mr-cfg-gh-pop-target">
          <span className="mr-cfg-mono">{doc.repoFullName}</span>
          <RepoVisibilityBadge visibility={gh.connection?.repo?.repo_full_name === doc.repoFullName ? gh.connection?.repo?.visibility ?? null : null} />
          <span className="mr-cfg-gh-fine">{doc.branch} · {doc.path}</span>
        </div>

        {!gh.capabilities.write ? (
          <div className="mr-cfg-gh-capability" role="status">
            <p className="mr-cfg-gh-banner">
              This GitHub App is installed read-only, so nothing can be published yet. Set its
              <strong> Contents </strong> permission to <strong>Read &amp; write</strong> on GitHub, then reconnect.
            </p>
            <div className="mr-cfg-gh-actions">
              {gh.appSlug ? (
                <a className="mr-cfg-btn" href={githubAppPermissionsUrl(gh.appSlug)} target="_blank" rel="noreferrer noopener">
                  Open App permissions
                </a>
              ) : null}
              <ActionButton variant="quiet" onClick={onManageInConnections}>Manage in Connections</ActionButton>
            </div>
          </div>
        ) : null}

        {remoteChanged ? (
          <div className="mr-cfg-gh-remote" role="status">
            <p className="mr-cfg-gh-banner">
              GitHub has a newer version of this file. Review before committing — committing now may be refused as a conflict.
            </p>
            {confirmingReRead ? (
              <div className="mr-cfg-gh-actions">
                <ActionButton variant="danger" loading={reReading} busyLabel="Re-reading" onClick={reRead}>
                  Replace my edits with GitHub’s copy
                </ActionButton>
                <ActionButton variant="quiet" disabled={reReading} onClick={() => setConfirmingReRead(false)}>
                  Keep my edits
                </ActionButton>
              </div>
            ) : (
              <ActionButton onClick={() => setConfirmingReRead(true)}>Re-read from GitHub…</ActionButton>
            )}
          </div>
        ) : null}

        <Segmented value={view} options={POPOVER_VIEWS} onChange={setView} ariaLabel="Commit content view" />

        {view === 'compare' ? (
          <div className="mr-cfg-gh-compare">
            <div className="mr-cfg-gh-compare-head">
              <span>Previous (GitHub) → Yours</span>
              <span className="mr-cfg-gh-compare-count">
                <em className="is-add">+{summary.added}</em>
                <em className="is-remove">−{summary.removed}</em>
              </span>
            </div>
            {coarse ? (
              <p className="mr-cfg-gh-fine">This document is large, so the diff is summarised coarsely. The counts above are still exact.</p>
            ) : null}
            <ol className="mr-cfg-gh-diff" aria-label="Differences from the GitHub version">
              {rows.slice(0, DIFF_RENDER_MAX_ROWS).map((row, index) => (
                <DiffRow key={index} row={row} />
              ))}
            </ol>
            {rows.length > DIFF_RENDER_MAX_ROWS ? (
              <p className="mr-cfg-gh-fine">{rows.length - DIFF_RENDER_MAX_ROWS} more lines not shown.</p>
            ) : null}
          </div>
        ) : (
          <pre className="mr-cfg-gh-pop-body" aria-label="Content that will be committed">{doc.markdown}</pre>
        )}

        <div className="mr-cfg-gh-field">
          <label className="mr-cfg-gh-field-label" htmlFor="mr-gh-pop-message">Commit message</label>
          <input
            id="mr-gh-pop-message"
            className="mr-cfg-input"
            value={message}
            maxLength={200}
            placeholder={`Update ${doc.path}`}
            autoComplete="off"
            onChange={(event) => setMessage(event.target.value)}
          />
        </div>

        <div className="mr-cfg-gh-pop-row">
          <Segmented
            value={mode}
            options={[
              { id: 'commit' as const, label: 'Commit to branch', hint: `Direct commit to ${doc.branch}` },
              { id: 'pr' as const, label: 'Propose a pull request', hint: 'New branch, then review' },
            ]}
            onChange={setMode}
            ariaLabel="Publish mode"
          />
        </div>

        <div className="mr-cfg-gh-pop-actions">
          <ActionButton variant="quiet" onClick={onManageInConnections}>Manage in Connections</ActionButton>
          <ActionButton
            variant="primary"
            loading={gh.publishing}
            busyLabel="Publishing"
            disabled={!canCommit}
            title={!dirty ? 'No changes to commit' : !gh.capabilities.write ? 'Publishing is disabled until the App has write access' : undefined}
            onClick={() => submit()}
          >
            {mode === 'pr' ? 'Open pull request' : 'Commit'}
          </ActionButton>
        </div>

        {!dirty ? <p className="mr-cfg-gh-fine">No changes to commit — this document matches its GitHub version.</p> : null}

        {gh.publishError ? (
          <div className="mr-cfg-gh-publish-error">
            <StatusNotice tone="error" onDismiss={gh.clearPublish}>{gh.publishError}</StatusNotice>
            {gh.publishConflict && mode === 'commit' ? (
              <ActionButton loading={gh.publishing} onClick={() => submit('pr')}>
                Propose as a pull request instead
              </ActionButton>
            ) : null}
          </div>
        ) : null}

        {gh.publishResult ? (
          <StatusNotice onDismiss={gh.clearPublish}>
            {gh.publishResult.kind === 'commit'
              ? <>{gh.publishResult.created ? 'Committed' : 'Updated'} {gh.publishResult.path} on {gh.publishResult.branch}</>
              : <>Pull request #{gh.publishResult.pull_number} opened</>}
          </StatusNotice>
        ) : null}

        {gh.publishing ? <InlineLoader label="Publishing to GitHub…" /> : null}
      </div>
    </div>
  )
}

function DiffRow({ row }: { row: DiffLine }) {
  const marker = row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '
  return (
    <li className={`mr-cfg-gh-diff-row is-${row.kind}`}>
      <span className="mr-cfg-gh-diff-no">{row.aLine ?? ''}</span>
      <span className="mr-cfg-gh-diff-no">{row.bLine ?? ''}</span>
      <span className="mr-cfg-gh-diff-mark" aria-hidden="true">{marker}</span>
      <span className="mr-cfg-gh-diff-text">{row.text || ' '}</span>
    </li>
  )
}
