'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Ic } from '../icons'
import { downloadBlob, sanitizeExportFilename, type Job } from '../utils'
import { createReviewReport, reviewIssues } from './model'
import { SourcePdfPage } from './SourcePdfPage'

type Props = {
  job: Job
  onEdit: (id: string, markdown: string) => void
  onAcknowledge: (id: string, issue: string, revision: number, checked: boolean) => void
  onAttach: (id: string, file: File) => Promise<void>
  onClose: () => void
}

export function ReviewDialog({ job, onEdit, onAcknowledge, onAttach, onClose }: Props) {
  const review = job.extractionReview
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const [tab, setTab] = useState<'checks' | 'source' | 'draft'>('checks')
  const [page, setPage] = useState(review?.pages[0]?.page_number ?? 1)
  const [password, setPassword] = useState(job.password ?? '')
  const [passwordDraft, setPasswordDraft] = useState('')
  const [info, setInfo] = useState<{ file: File; pages: number } | null>(null)
  const [rendered, setRendered] = useState<{ file: File; page: number; ready: boolean } | null>(null)
  const [busy, setBusy] = useState<'attach' | 'report' | null>(null)
  const [notice, setNotice] = useState('')
  const file = job.sourcePdf ?? null
  const sourceAvailable = !!file && !!review?.source.sha256
  const pages = info?.file === file ? info.pages : null
  const canAcknowledge = sourceAvailable && rendered?.file === file && rendered.page === page && rendered.ready
  const issues = review ? reviewIssues(review) : []
  const acknowledged = sourceAvailable ? review?.acknowledged.length ?? 0 : 0
  const onInfo = useCallback((source: File, total: number) => setInfo({ file: source, pages: total }), [])
  const onReady = useCallback((source: File, number: number, ready: boolean) => setRendered({ file: source, page: number, ready }), [])

  useEffect(() => {
    const dialog = dialogRef.current
    const previous = document.activeElement
    dialog?.showModal()
    return () => {
      dialog?.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  const attach = async (source: File) => {
    setBusy('attach')
    setNotice('Checking that this is the original PDF...')
    try {
      await onAttach(job.id, source)
      setNotice('Original PDF matched. Reattachment stays in this browser.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The original PDF could not be attached.')
    } finally {
      setBusy(null)
    }
  }

  const downloadReport = async () => {
    if (!review) return
    setBusy('report')
    try {
      const report = await createReviewReport(review, job.markdown, sourceAvailable)
      downloadBlob(JSON.stringify(report, null, 2), `${sanitizeExportFilename(job.title)}.review.json`, 'application/json;charset=utf-8')
      setNotice(`Review report downloaded for draft revision ${review.revision}. It is not a correctness certificate.`)
    } catch {
      setNotice('The review report could not be created. Your draft is unchanged.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <dialog ref={dialogRef} className="mr-review" aria-labelledby={titleId} onKeyDown={(event) => event.stopPropagation()} onCancel={(event) => { event.preventDefault(); onClose() }}>
      <header className="mr-review-head">
        <div>
          <span className="mr-review-eyebrow">Document Rescue / Review Pilot</span>
          <h2 id={titleId}>Compare before you share</h2>
          <p>{job.title} <span aria-hidden="true">/</span> {review ? `Draft revision ${review.revision}` : 'No extraction record'}</p>
        </div>
        <button className="mr-review-button" type="button" onClick={onClose}>{Ic.close(14)} Close review</button>
      </header>

      {!review ? (
        <div className="mr-review-empty">
          <h3>No source diagnostics for this document</h3>
          <p>Blank drafts, merged documents and older history entries do not carry a PDF extraction record. Import the original PDF with the review pilot enabled to create one. Your current draft is unchanged.</p>
        </div>
      ) : (
        <>
          <div className="mr-review-summary">
            <strong>{acknowledged}/{issues.length} acknowledged</strong>
            <span>Human review, not automatic verification. Edits reset acknowledgements.</span>
            <button type="button" className="mr-review-button" onClick={downloadReport} disabled={busy !== null}>{Ic.download(14)} {busy === 'report' ? 'Preparing report...' : 'Review report'}</button>
          </div>
          {review.revision > 0 && <p className="mr-review-context">The draft has changed since extraction. Page diagnostics still describe the original conversion, not the edited text.</p>}
          <div className="mr-review-tabs" role="group" aria-label="Review view">
            {(['checks', 'source', 'draft'] as const).map((view) => <button key={view} type="button" aria-pressed={tab === view} onClick={() => setTab(view)}>{view === 'checks' ? 'Review queue' : view === 'source' ? 'Original PDF' : 'Current draft'}</button>)}
          </div>
          <div className="mr-review-body" data-tab={tab}>
            <section className="mr-review-pane mr-review-checks" data-pane="checks" aria-label="Extraction review queue">
              <div className="mr-review-pane-head"><h3>Review queue</h3><span>{review.pages.length} page diagnostics</span></div>
              <div className="mr-review-check-list">
                {issues.map((issue) => {
                  const checked = sourceAvailable && review.acknowledged.includes(issue.id)
                  const onPage = issue.page === null || issue.page === page
                  return (
                    <article key={issue.id} className="mr-review-issue" data-acknowledged={checked}>
                      <div className="mr-review-issue-meta"><span>{issue.status === 'failed' ? 'Extraction failed' : issue.status === 'warning' ? 'Notice' : 'Not automatically checked'}</span>{issue.page !== null && <button type="button" onClick={() => { setPage(issue.page!); setTab('source') }}>Page {issue.page} {Ic.arrow(11)}</button>}</div>
                      <h4>{issue.title}</h4>
                      <p>{issue.detail}</p>
                      <label><input type="checkbox" checked={checked} disabled={!canAcknowledge || !onPage} onChange={(event) => onAcknowledge(job.id, issue.id, review.revision, event.target.checked)} /> I reviewed this against the original</label>
                      {!onPage && <small>Open the indicated source page to review this notice.</small>}
                    </article>
                  )
                })}
              </div>
              <p className="mr-review-pane-note">Acknowledge only after inspecting the original. Notices are not automatically repaired or certified by checking a box.</p>
            </section>

            <section className="mr-review-pane" data-pane="source" aria-label="Original PDF source">
              <div className="mr-review-pane-head"><h3>Original PDF</h3>{file && <button type="button" className="mr-review-text-button" onClick={() => downloadBlob(file, review.source.name, 'application/pdf')}>Download original</button>}</div>
              {file ? (
                <>
                  <div className="mr-review-pager">
                    <button type="button" aria-label="Previous original page" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>{Ic.chevron(13)}</button>
                    <label>Page <input aria-label="Original PDF page" type="number" min="1" max={pages ?? undefined} value={page} onChange={(event) => { const next = Number(event.target.value); if (Number.isInteger(next) && next > 0 && (!pages || next <= pages)) setPage(next) }} /> {pages ? `of ${pages}` : '(loading count)'}</label>
                    <button type="button" aria-label="Next original page" disabled={!pages || page >= pages} onClick={() => setPage((current) => current + 1)}>{Ic.chevron(13)}</button>
                  </div>
                  <details className="mr-review-password"><summary>PDF password</summary><form onSubmit={(event) => { event.preventDefault(); setPassword(passwordDraft) }}><input type="password" aria-label="Original PDF password" value={passwordDraft} onChange={(event) => setPasswordDraft(event.target.value)} autoComplete="off" /><button type="submit" className="mr-review-button">Unlock preview</button></form></details>
                  <div className="mr-review-source-scroll"><SourcePdfPage file={file} page={page} password={password} onInfo={onInfo} onReady={onReady} /></div>
                  <p className="mr-review-pane-note">Rendered from local PDF bytes. This pilot links pages, not individual words or table cells.</p>
                </>
              ) : (
                <div className="mr-review-empty">
                  <h4>Reattach the original PDF</h4>
                  <p>The PDF is not stored with your saved draft. Reattach it to compare the original; its SHA-256 must match the conversion record.</p>
                  <button type="button" className="mr-review-button" disabled={busy !== null || !review.source.sha256} onClick={() => inputRef.current?.click()}>{busy === 'attach' ? 'Checking original...' : 'Choose original PDF'}</button>
                  {!review.source.sha256 && <p>No source fingerprint is available. Import the PDF again to start a source-linked review.</p>}
                </div>
              )}
              <input ref={inputRef} type="file" accept=".pdf,application/pdf" hidden onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void attach(selected) }} />
            </section>

            <section className="mr-review-pane" data-pane="draft" aria-label="Current Markdown draft">
              <div className="mr-review-pane-head"><h3>Current draft</h3><span>{job.markdown.length.toLocaleString()} characters</span></div>
              <textarea className="mr-review-draft" aria-label="Edit the reviewed Markdown draft" value={job.markdown} onChange={(event) => onEdit(job.id, event.target.value)} spellCheck={false} />
              <p className="mr-review-pane-note">This is the same draft as the editor. Corrections are saved through its existing session flow; the original PDF is never modified.</p>
            </section>
          </div>
        </>
      )}
      <footer className="mr-review-foot"><p role="status">{notice || (!sourceAvailable && review ? 'Attach the matching original and open a source page before acknowledging checks.' : 'Names, numbers, table cells and completeness still require human review.')}</p><button type="button" className="mr-review-button" onClick={onClose}>Return to editor</button></footer>
    </dialog>
  )
}
