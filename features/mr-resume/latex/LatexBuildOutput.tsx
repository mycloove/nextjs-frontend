'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { feedbackIdentity, MAX_FEEDBACK_ACTIVITY, type FeedbackFact } from './feedback.ts'
import { atOutputEnd, visibleBuildLog, type WorkspaceUi } from './workspaceUi.ts'
import { downloadBlob } from './projectImport'
import type { LatexDiagnostic } from './types.ts'
import styles from './LatexBuildOutput.module.css'

export default function LatexBuildOutput({ log, identity, projectId, activity, view, onView, filename, diagnostics, onDiagnostic, canNavigate }: {
  log: string; identity: string; projectId: string | null; activity: readonly FeedbackFact[]; view: WorkspaceUi['outputView']
  onView: (view: WorkspaceUi['outputView']) => void; filename: string; diagnostics: readonly LatexDiagnostic[]
  onDiagnostic: (diagnostic: LatexDiagnostic) => void; canNavigate: (diagnostic: LatexDiagnostic) => boolean
}) {
  const scroll = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState(''), [pausedAt, setPausedAt] = useState<string | null>(null), [copyStatus, setCopyStatus] = useState('')
  const [cleared, setCleared] = useState<{ identity: string; log: string; activity: string[] } | null>(null)
  const allEntries = activity.filter((entry) => entry.projectId === null || entry.projectId === projectId).slice(-MAX_FEEDBACK_ACTIVITY)
  const clearApplies = cleared?.identity === identity
  const skipped = clearApplies && cleared.log.length > 0 && log.startsWith(cleared.log) ? cleared.log.split(/\r\n|\r|\n/u).length : 0
  const visible = visibleBuildLog(log, query, skipped)
  const entries = allEntries.filter((entry) => (!clearApplies || !cleared.activity.includes(`${feedbackIdentity(entry)}:${entry.updatedAt}`))
    && (!query.trim() || `${entry.category} ${entry.summary}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
  const contentKey = `${identity}:${view}:${log}:${allEntries.map((entry) => `${entry.id}:${entry.updatedAt}:${entry.summary}`).join('|')}`
  const newOutput = pausedAt !== null && pausedAt !== contentKey

  useLayoutEffect(() => {
    const element = scroll.current
    if (element && pausedAt === null) element.scrollTop = element.scrollHeight
  }, [contentKey, pausedAt, query, skipped])

  async function copyLog() {
    try { await navigator.clipboard.writeText(log); setCopyStatus('Build log copied.') }
    catch { setCopyStatus('Clipboard unavailable. Download the build log instead.') }
  }

  return <div className={styles.output}>
    <div className={styles.toolbar}>
      <label className={styles.srOnly} htmlFor="resume-latex-output-view">Output stream</label>
      <select id="resume-latex-output-view" value={view} onChange={(event) => { setQuery(''); setCopyStatus(''); onView(event.target.value as WorkspaceUi['outputView']) }}><option value="log">Build log</option><option value="activity">Session activity</option></select>
      <label className={styles.find}>Filter<input aria-label="Filter build output" value={query} maxLength={128} onChange={(event) => setQuery(event.target.value)} placeholder="Find text" spellCheck={false} /></label>
      <button type="button" disabled={!log} onClick={() => void copyLog()}>Copy log</button>
      <button type="button" disabled={!log} onClick={() => downloadBlob(new Blob([log], { type: 'text/plain;charset=utf-8' }), filename)}>Download log</button>
      <button type="button" onClick={() => setCleared({ identity, log, activity: allEntries.map((entry) => `${feedbackIdentity(entry)}:${entry.updatedAt}`) })}>Clear display</button>
      {clearApplies && <button type="button" onClick={() => setCleared(null)}>Show retained output</button>}
    </div>
    <p className={styles.context}>{view === 'log' ? 'Read-only compiler output. Copy and download use the retained log, not this filtered display.' : `This session only, latest ${MAX_FEEDBACK_ACTIVITY} entries. Clearing this display does not delete build evidence or checkpoints.`}</p>
    {copyStatus && <p className={styles.context} role="status">{copyStatus}</p>}
    {view === 'log' && diagnostics.some((item) => item.severity === 'error') && <div className={styles.errorLinks} aria-label="Compiler error locations">{diagnostics.filter((item) => item.severity === 'error').slice(0, 8).map((item, index) => <button key={index} type="button" disabled={!canNavigate(item)} onClick={() => onDiagnostic(item)} title={item.message}>{item.file && item.line ? `${item.file}:${item.line}` : 'Build-level error'}</button>)}</div>}
    <div ref={scroll} className={styles.scroll} tabIndex={0} aria-label={view === 'log' ? 'Read-only build log' : 'Session activity output'} onScroll={(event) => {
      const element = event.currentTarget
      if (atOutputEnd(element.scrollTop, element.scrollHeight, element.clientHeight)) setPausedAt(null)
      else setPausedAt((value) => value ?? contentKey)
    }}>
      {view === 'log' ? <>
        {visible.truncated && <p className={styles.context}>Showing the latest {visible.lines.length} of {visible.total} matching lines. The retained log is unchanged.</p>}
        {visible.lines.length ? <pre className={styles.log}>{visible.lines.map((line) => <span key={line.line}>{line.text}{'\n'}</span>)}</pre> : <p className={styles.context}>{log ? 'No output matches this display.' : 'No compiler log yet. Compile to generate output.'}</p>}
      </> : entries.length ? <ol className={styles.activity}>{entries.map((entry) => <li key={`${feedbackIdentity(entry)}:${entry.lifecycle}`} data-severity={entry.severity}><span>{entry.category}{entry.revision !== undefined ? ` / r${entry.revision}` : ''}</span><p>{entry.summary}</p></li>)}</ol> : <p className={styles.context}>No session activity matches this display.</p>}
    </div>
    {newOutput && <button type="button" className={styles.newOutput} onClick={() => { setPausedAt(null); if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight }}>New output: go to latest</button>}
  </div>
}
