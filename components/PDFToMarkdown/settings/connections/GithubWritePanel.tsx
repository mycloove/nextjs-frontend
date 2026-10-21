'use client'

import { GITHUB_SCOPE_SUMMARY, githubAppPermissionsUrl } from '@/lib/integrations/github/scopes'
import type { GithubWriteMode } from '@/lib/integrations/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActiveDocument, OpenDocument, OpenDocumentResult, SourcedDocument } from '../settingsContext'
import { Segmented } from '../sections/parts'
import ActionButton from './ActionButton'
import InlineLoader from './InlineLoader'
import RepoVisibilityBadge from './RepoVisibilityBadge'
import StatusNotice from './StatusNotice'
import { buildGithubSourceId } from './githubSourceId'
import { diffLines, isDiffTooLarge, summariseDiff, type DiffLine } from './markdownLineDiff'
import type { GithubConnectionHook } from './useGithubConnection'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** A document title from a repository path: `docs/getting-started.md` → `getting started`. */
function titleFromPath(path: string): string {
  const base = path.split('/').filter(Boolean).pop() ?? 'document'
  const stem = base.replace(/\.[^.]+$/, '')
  return stem.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'document'
}

/** How long the panel's typing buffer waits before it is written through. */
const WRITE_THROUGH_DEBOUNCE_MS = 300
/** Above this many rendered rows the compare view truncates and says so. */
const DIFF_RENDER_MAX_ROWS = 1200

/**
 * Level 4 of the dock: the work, in the order it happens — **browse → edit →
 * publish** — with each stage labelled so the sequence is never in doubt.
 *
 * Reading is a browse (every Markdown file, opened into an editable body).
 * Writing is never ambient: the owner names the path, the branch, the message and
 * the mode, presses Publish, and sees the commit or PR GitHub actually created.
 * When the App is still read-only the publish controls are not rendered at all,
 * with the exact reason and the GitHub page to fix it.
 *
 * When a file is *also* open in the workspace editor, the two are the same
 * document: the panel writes through to it (debounced, and flushed on blur, on
 * file switch and on close, so the last keystroke is never lost), reads its
 * baseline to show "edited", and can commit it from here or from the editor's
 * chip. Non-sourced files keep the original purely-local draft behaviour.
 */
export default function GithubWritePanel({
  gh,
  activeDocument,
  onOpenDocument,
  sourcedDocuments = [],
  focusSourceId,
  editSourcedDocument,
  resetSourcedDocument,
}: {
  gh: GithubConnectionHook
  activeDocument?: ActiveDocument
  onOpenDocument?: OpenDocument
  sourcedDocuments?: SourcedDocument[]
  focusSourceId?: string
  editSourcedDocument?: (sourceId: string, markdown: string) => void
  resetSourcedDocument?: (sourceId: string, markdown: string, sha: string | null) => void
}) {
  const [filter, setFilter] = useState('')

  const repoFullName = gh.connection?.repo?.repo_full_name ?? ''
  const visibility = gh.connection?.repo?.visibility ?? null
  const defaultBranch = gh.connection?.repo?.default_branch ?? ''
  const files = useMemo(() => {
    const term = filter.trim().toLowerCase()
    if (!term) return gh.files
    return gh.files.filter((file) => file.path.toLowerCase().includes(term))
  }, [gh.files, filter])

  /* Documents in this repository that have uncommitted edits, shown as a
     priority group above the plain file list so the owner never has to hunt for
     the file they were working on. */
  const editedDocuments = useMemo(
    () => sourcedDocuments.filter((doc) => doc.dirty && (!repoFullName || doc.repoFullName === repoFullName)),
    [sourcedDocuments, repoFullName],
  )
  const dirtyByPath = useMemo(() => {
    const map = new Set<string>()
    for (const doc of editedDocuments) map.add(doc.path)
    return map
  }, [editedDocuments])

  /* "Manage in Connections" hands the console a file to focus. Read it once so
     the writer opens on the document the owner came for. */
  const focusPath = useMemo(() => {
    if (!focusSourceId) return null
    const doc = sourcedDocuments.find((candidate) => candidate.sourceId === focusSourceId)
    if (!doc || (repoFullName && doc.repoFullName !== repoFullName)) return null
    return doc.path
  }, [focusSourceId, sourcedDocuments, repoFullName])
  const handledFocusRef = useRef<string | null>(null)
  const readFile = gh.readFile
  useEffect(() => {
    if (!focusPath || handledFocusRef.current === focusPath) return
    handledFocusRef.current = focusPath
    if (gh.openFile?.path !== focusPath) readFile(focusPath)
  }, [focusPath, readFile, gh.openFile?.path])

  return (
    <article className="mr-cfg-gh-card is-picker is-writer">
      <div className="mr-cfg-gh-main">
        <div className="mr-cfg-gh-head">
          <strong>Work area</strong>
          <span className="mr-cfg-gh-scope">{GITHUB_SCOPE_SUMMARY}</span>
        </div>

        <div className="mr-cfg-gh-spec-row mr-cfg-gh-target">
          <dt>Target</dt>
          <dd>
            <span className="mr-cfg-mono">{repoFullName || '—'}</span>
            <RepoVisibilityBadge visibility={visibility} />
            {defaultBranch ? <span className="mr-cfg-gh-fine">on {defaultBranch}</span> : null}
          </dd>
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
              <a className="mr-cfg-btn mr-cfg-btn-quiet" href="https://github.com/settings/installations" target="_blank" rel="noreferrer noopener">
                Review installations
              </a>
            </div>
          </div>
        ) : null}

        <div className="mr-cfg-gh-browser">
          <div className="mr-cfg-gh-browser-head">
            <span className="mr-cfg-gh-level">
              <em>Browse</em>
              <span>{gh.files.length === 1 ? '1 Markdown file' : `${gh.files.length} Markdown files`}</span>
            </span>
            <ActionButton variant="link" loading={gh.loadingFiles} iconOnlyWhileLoading onClick={gh.reloadFiles}>
              reload
            </ActionButton>
          </div>

          {gh.files.length > 6 ? (
            <input
              className="mr-cfg-input"
              value={filter}
              placeholder="Filter files…"
              spellCheck={false}
              autoComplete="off"
              aria-label="Filter Markdown files"
              onChange={(event) => setFilter(event.target.value)}
            />
          ) : null}

          {editedDocuments.length > 0 ? (
            <div className="mr-cfg-gh-recent">
              <span className="mr-cfg-gh-level">
                <em>Recent edits</em>
                <span>{editedDocuments.length === 1 ? '1 edited file' : `${editedDocuments.length} edited files`}</span>
              </span>
              <ul className="mr-cfg-gh-recent-list">
                {editedDocuments.map((doc) => {
                  const active = gh.openFile?.path === doc.path
                  return (
                    <li key={doc.sourceId}>
                      <button
                        type="button"
                        className={`mr-cfg-gh-file ${active ? 'is-active' : ''}`}
                        onClick={() => gh.readFile(doc.path)}
                      >
                        <span className="mr-cfg-gh-file-path">{doc.path}</span>
                        <span className="mr-cfg-gh-dirty" title="Edited, not committed">Edited</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          {gh.loadingFiles ? (
            <InlineLoader label="Listing the repository…" />
          ) : files.length === 0 ? (
            <p className="mr-cfg-gh-fine">
              {gh.files.length === 0 ? 'No Markdown files were found on this branch.' : 'No files match that filter.'}
            </p>
          ) : (
            <ul className="mr-cfg-gh-files">
              {files.map((file) => {
                const active = gh.openFile?.path === file.path
                const edited = dirtyByPath.has(file.path)
                return (
                  <li key={file.path}>
                    <button
                      type="button"
                      className={`mr-cfg-gh-file ${active ? 'is-active' : ''}`}
                      onClick={() => gh.readFile(file.path)}
                    >
                      <span className="mr-cfg-gh-file-path">{file.path}</span>
                      {edited ? <span className="mr-cfg-gh-dirty" title="Edited, not committed">Edited</span> : null}
                      <span className="mr-cfg-gh-file-size">{formatBytes(file.size)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {gh.filesTruncated ? (
            <p className="mr-cfg-gh-fine">More Markdown files exist than are listed here; the first 500 are shown.</p>
          ) : null}
        </div>

        {gh.openFile ? (
          <WriteArea
            key={`${gh.openFile.path}@${gh.openFile.branch}`}
            gh={gh}
            repoFullName={repoFullName}
            defaultBranch={defaultBranch || gh.openFile.branch}
            initialPath={gh.openFile.path}
            initialContent={gh.openFile.content ?? gh.openFile.snippet}
            initialSha={gh.openFile.sha ?? null}
            initialBranch={gh.openFile.branch}
            sourcedDocuments={sourcedDocuments}
            editSourcedDocument={editSourcedDocument}
            resetSourcedDocument={resetSourcedDocument}
            activeDocument={activeDocument}
            onOpenDocument={onOpenDocument}
          />
        ) : gh.opening ? (
          <InlineLoader label="Opening the file…" />
        ) : (
          <WriteArea
            key="blank"
            gh={gh}
            repoFullName={repoFullName}
            defaultBranch={defaultBranch}
            initialPath={gh.connection?.repo?.selected_path ?? 'README.md'}
            initialContent=""
            initialSha={null}
            initialBranch={defaultBranch}
            sourcedDocuments={sourcedDocuments}
            editSourcedDocument={editSourcedDocument}
            resetSourcedDocument={resetSourcedDocument}
            activeDocument={activeDocument}
          />
        )}
      </div>
    </article>
  )
}

/**
 * The editable body plus its publish controls. Mounted with a `key` per file so
 * its draft state resets by remount instead of an effect syncing props→state.
 *
 * When the file is also open as a workspace document, `draft` is a *typing buffer*
 * over that one document: every keystroke reaches the workspace on a short
 * debounce, and the buffer is flushed on blur, on Publish, and on unmount — so
 * closing the console can never silently drop the last words typed.
 */
function WriteArea({
  gh,
  repoFullName,
  defaultBranch,
  initialPath,
  initialContent,
  initialSha,
  initialBranch,
  sourcedDocuments,
  editSourcedDocument,
  resetSourcedDocument,
  activeDocument,
  onOpenDocument,
}: {
  gh: GithubConnectionHook
  repoFullName: string
  defaultBranch: string
  initialPath: string
  initialContent: string
  initialSha: string | null
  initialBranch: string
  sourcedDocuments: SourcedDocument[]
  editSourcedDocument?: (sourceId: string, markdown: string) => void
  resetSourcedDocument?: (sourceId: string, markdown: string, sha: string | null) => void
  activeDocument?: ActiveDocument
  onOpenDocument?: OpenDocument
}) {
  // The provenance key for this exact repo file. Write-through and the editor's
  // commit chip both use it, so "the same file" means the same thing everywhere.
  const sourceId = buildGithubSourceId(repoFullName, initialBranch, initialPath)
  const sourced = gh.openFile ? sourcedDocuments.find((doc) => doc.sourceId === sourceId) : undefined

  const [draft, setDraft] = useState(() => (sourced ? sourced.markdown : initialContent))
  const [path, setPath] = useState(initialPath)
  const [branch, setBranch] = useState(initialBranch || defaultBranch)
  const [message, setMessage] = useState('')
  const [mode, setMode] = useState<GithubWriteMode>('commit')
  const [view, setView] = useState<'current' | 'compare'>('current')
  const [confirmingReRead, setConfirmingReRead] = useState(false)
  const [reReading, setReReading] = useState(false)
  /** Outcome of the last hand-over, reported here rather than as a global toast. */
  const [openNote, setOpenNote] = useState<OpenDocumentResult | null>(null)
  /**
   * The baseline after this panel's own commit, for a file that is *not* also open
   * as a workspace document (a sourced document's baseline is advanced by the
   * workspace itself). Without this the panel would keep claiming "edited" after a
   * successful commit. Null until a commit lands.
   */
  const [committedBaseline, setCommittedBaseline] = useState<string | null>(null)

  // The baseline the draft is compared against: a sourced document's recorded
  // GitHub version, the last content this panel actually committed, otherwise the
  // content as it was read from GitHub. "Edited" is this comparison and nothing
  // else — edit back to the baseline and it clears.
  const baseline = sourced ? sourced.baseMarkdown : (committedBaseline ?? initialContent)
  const dirty = draft !== baseline
  const canPublish = gh.capabilities.write && draft.trim().length > 0 && path.trim().length > 0 && branch.trim().length > 0 && dirty

  /* ── Write-through: local buffer → the one workspace document ───────── */
  // `draftRef` mirrors the buffer for the unmount flush, which must read the
  // latest value. It is written in the change handlers and the re-read path (both
  // outside render), never during render.
  const draftRef = useRef(draft)
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canWriteThrough = Boolean(sourced && editSourcedDocument)

  const flushDraft = useCallback(() => {
    // Only a *pending* buffer is flushed: an already-settled buffer has been
    // written, and flushing an unchanged value would loop through the workspace
    // state for nothing. Idempotent, so React StrictMode's double-invoke is safe.
    if (!draftTimerRef.current) return
    clearTimeout(draftTimerRef.current)
    draftTimerRef.current = null
    if (sourced && editSourcedDocument) editSourcedDocument(sourceId, draftRef.current)
  }, [sourced, editSourcedDocument, sourceId])

  // Closing the console unmounts this area — the exact moment the original bug
  // lost the last keystrokes, so the flush here is not optional.
  useEffect(() => () => { flushDraft() }, [flushDraft])

  const handleDraftChange = (value: string) => {
    setDraft(value)
    draftRef.current = value
    gh.clearPublish()
    if (!canWriteThrough || !editSourcedDocument) return
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null
      editSourcedDocument(sourceId, value)
    }, WRITE_THROUGH_DEBOUNCE_MS)
  }

  /* A commit that landed and was for *this* file advances the local baseline, so
     the panel stops claiming "edited" for a file the workspace does not track.
     Guarded by the publish result's identity so a re-render cannot re-apply it. */
  const lastHandledPublishRef = useRef<GithubConnectionHook['publishResult']>(null)
  useEffect(() => {
    const result = gh.publishResult
    if (!result || result === lastHandledPublishRef.current) return
    lastHandledPublishRef.current = result
    if (result.kind !== 'commit') return
    if (result.path !== path.trim() || result.branch !== branch.trim()) return
    setCommittedBaseline(draftRef.current)
  }, [gh.publishResult, path, branch])

  /* ── Remote drift: does GitHub have a newer copy? ───────────────────── */
  const checkRemote = gh.checkRemote
  useEffect(() => {
    if (!sourced?.dirty || !sourced.baseSha) return
    checkRemote({ path: sourced.path, branch: sourced.branch, sha: sourced.baseSha })
  }, [checkRemote, sourced?.sourceId, sourced?.dirty, sourced?.baseSha, sourced?.path, sourced?.branch])

  const remoteCheck = gh.remoteCheck
  const remoteChanged = Boolean(
    sourced
    && remoteCheck
    && remoteCheck.path === sourced.path
    && remoteCheck.branch === sourced.branch
    && remoteCheck.changed
    && remoteCheck.baselineSha === sourced.baseSha,
  )

  const reRead = () => {
    if (!sourced || !resetSourcedDocument) return
    setReReading(true)
    gh.pullFile(sourced.path).then((file) => {
      setReReading(false)
      if (!file || typeof file.content !== 'string') return
      // Replace both sides: the workspace document's content *and* its baseline
      // move to the freshly read copy, and the local buffer follows immediately
      // so they cannot diverge.
      resetSourcedDocument(sourced.sourceId, file.content, file.sha ?? null)
      if (draftTimerRef.current) { clearTimeout(draftTimerRef.current); draftTimerRef.current = null }
      setDraft(file.content)
      draftRef.current = file.content
      setConfirmingReRead(false)
      gh.clearRemoteCheck()
    })
  }

  const submit = (nextMode: GithubWriteMode = mode) => {
    flushDraft()
    gh.publish({
      repoFullName,
      path: path.trim(),
      content: draftRef.current,
      message: message.trim(),
      branch: branch.trim(),
      mode: nextMode,
    })
  }

  const rows = useMemo(() => diffLines(baseline, draft), [baseline, draft])
  const summary = useMemo(() => summariseDiff(baseline, draft), [baseline, draft])
  const coarse = useMemo(() => isDiffTooLarge(baseline, draft), [baseline, draft])

  return (
    <div className="mr-cfg-gh-writer">
      <div className="mr-cfg-gh-writer-head">
        <span className="mr-cfg-gh-level">
          <em>Edit</em>
          <span>{gh.openFile ? gh.openFile.path : 'new document'}</span>
        </span>
        <div className="mr-cfg-gh-writer-tools">
          {dirty ? <span className="mr-cfg-gh-dirty" title="Edited, not committed">Edited</span> : null}
          {gh.openFile && onOpenDocument ? (
            <ActionButton
              variant="link"
              disabled={!draft.trim()}
              onClick={() => {
                flushDraft()
                const result = onOpenDocument({
                  title: titleFromPath(initialPath),
                  markdown: draftRef.current,
                  // Provenance: the workspace focuses the document already open for
                  // this exact repo file instead of cloning it.
                  sourceId,
                  // The version read from GitHub is this document's baseline, so a
                  // later edit is measured against the copy it actually came from.
                  baseMarkdown: gh.openFile ? gh.openFile.content ?? initialContent : initialContent,
                  baseSha: gh.openFile ? gh.openFile.sha ?? initialSha : null,
                })
                setOpenNote(result)
              }}
            >
              Open in Mr. Markdown
            </ActionButton>
          ) : null}
          {activeDocument?.markdown ? (
            <ActionButton
              variant="link"
              onClick={() => {
                handleDraftChange(activeDocument.markdown)
                gh.clearPublish()
              }}
            >
              Load “{activeDocument.title || 'current document'}”
            </ActionButton>
          ) : null}
          {gh.openFile ? (
            <ActionButton variant="link" onClick={() => { flushDraft(); gh.closeFile() }}>
              Close file
            </ActionButton>
          ) : null}
        </div>
      </div>

      {openNote ? (
        <StatusNotice onDismiss={() => setOpenNote(null)}>
          {openNote.outcome === 'created' ? (
            <>
              Opened <span className="mr-cfg-mono">{openNote.title}.md</span> in the editor — this panel stays open.
            </>
          ) : (
            <>
              <span className="mr-cfg-mono">{openNote.title}.md</span> is already open — focused it, your edits were kept.
            </>
          )}
        </StatusNotice>
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

      <div className="mr-cfg-gh-viewswitch">
        <Segmented
          value={view}
          options={[{ id: 'current' as const, label: 'Current' }, { id: 'compare' as const, label: 'Compare' }]}
          onChange={setView}
          ariaLabel="Editor body view"
        />
      </div>

      {view === 'compare' ? (
        <div className="mr-cfg-gh-compare">
          <div className="mr-cfg-gh-compare-head">
            <span>{sourced ? 'Previous (GitHub) → Yours' : 'Original → Yours'}</span>
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
        <textarea
          className="mr-cfg-gh-editor"
          value={draft}
          spellCheck={false}
          placeholder="# Write Markdown here, or open a file above."
          aria-label="Document body"
          onChange={(event) => handleDraftChange(event.target.value)}
          onBlur={flushDraft}
        />
      )}

      <span className="mr-cfg-gh-level">
        <em>Publish</em>
        <span>each change is confirmed</span>
      </span>

      <div className="mr-cfg-gh-publish">
        <div className="mr-cfg-gh-field">
          <label className="mr-cfg-gh-field-label" htmlFor="mr-gh-write-path">Path in repository</label>
          <input
            id="mr-gh-write-path"
            className="mr-cfg-input"
            value={path}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setPath(event.target.value)}
          />
        </div>
        <div className="mr-cfg-gh-field">
          <label className="mr-cfg-gh-field-label" htmlFor="mr-gh-write-branch">Branch</label>
          <input
            id="mr-gh-write-branch"
            className="mr-cfg-input"
            value={branch}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setBranch(event.target.value)}
          />
        </div>
      </div>

      <div className="mr-cfg-gh-field">
        <label className="mr-cfg-gh-field-label" htmlFor="mr-gh-write-message">Commit message</label>
        <input
          id="mr-gh-write-message"
          className="mr-cfg-input"
          value={message}
          maxLength={200}
          placeholder={`Update ${path || 'document'}`}
          autoComplete="off"
          onChange={(event) => setMessage(event.target.value)}
        />
      </div>

      <div className="mr-cfg-gh-publishrow">
        <div className="mr-cfg-segmented mr-cfg-gh-mode" role="radiogroup" aria-label="Publish mode">
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'commit'}
            className={`mr-cfg-segment ${mode === 'commit' ? 'is-active' : ''}`}
            onClick={() => setMode('commit')}
          >
            <span className="mr-cfg-segment-label">Commit to branch</span>
            <span className="mr-cfg-segment-hint">Direct commit to {branch || 'branch'}</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'pr'}
            className={`mr-cfg-segment ${mode === 'pr' ? 'is-active' : ''}`}
            onClick={() => setMode('pr')}
          >
            <span className="mr-cfg-segment-label">Propose a pull request</span>
            <span className="mr-cfg-segment-hint">New branch, then review</span>
          </button>
        </div>

        <ActionButton
          variant="primary"
          loading={gh.publishing}
          busyLabel="Publishing"
          disabled={!canPublish}
          title={!gh.capabilities.write ? 'Publishing is disabled until the App has write access' : !dirty ? 'No changes to commit' : undefined}
          onClick={() => submit()}
        >
          {mode === 'pr' ? 'Open pull request' : 'Commit'}
        </ActionButton>
      </div>

      {!gh.capabilities.write ? (
        <p className="mr-cfg-gh-fine">Publishing is disabled until the App has write access.</p>
      ) : !dirty ? (
        <p className="mr-cfg-gh-fine">No changes to commit — this body matches the GitHub version.</p>
      ) : null}

      {gh.publishError ? (
        <div className="mr-cfg-gh-publish-error">
          <StatusNotice tone="error" onDismiss={gh.clearPublish}>{gh.publishError}</StatusNotice>
          {gh.publishConflict && mode === 'commit' ? (
            <ActionButton loading={gh.publishing} onClick={() => submit('pr')}>
              Publish as a pull request instead
            </ActionButton>
          ) : null}
        </div>
      ) : null}

      {gh.publishResult ? <PublishOutcome result={gh.publishResult} onDismiss={gh.clearPublish} /> : null}
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

function PublishOutcome({
  result,
  onDismiss,
}: {
  result: NonNullable<GithubConnectionHook['publishResult']>
  onDismiss: () => void
}) {
  if (result.kind === 'commit') {
    return (
      <StatusNotice onDismiss={onDismiss}>
        {result.created ? 'Created' : 'Updated'} <span className="mr-cfg-mono">{result.path}</span> on{' '}
        <span className="mr-cfg-mono">{result.branch}</span>
        {result.commit_url ? (
          <>
            {' — '}
            <a className="mr-cfg-gh-linkbtn" href={result.commit_url} target="_blank" rel="noreferrer noopener">
              commit {result.commit_sha.slice(0, 7)}
            </a>
          </>
        ) : null}
      </StatusNotice>
    )
  }
  return (
    <StatusNotice onDismiss={onDismiss}>
      Pull request{' '}
      {result.pull_url ? (
        <a className="mr-cfg-gh-linkbtn" href={result.pull_url} target="_blank" rel="noreferrer noopener">
          #{result.pull_number}
        </a>
      ) : (
        `#${result.pull_number}`
      )}{' '}
      opened from <span className="mr-cfg-mono">{result.branch}</span> into <span className="mr-cfg-mono">{result.base_branch}</span>.
    </StatusNotice>
  )
}
