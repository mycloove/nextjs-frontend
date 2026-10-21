'use client'

import { useEffect, useState } from 'react'
import { fetchActivity, type ActivityRow } from '@/components/profile/profileApi'
import type { SettingsContext } from '../settingsContext'
import { PaneHead } from './parts'

const PAGE_SIZE = 8
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const seconds = Math.round((then - Date.now()) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000], ['month', 2_592_000], ['week', 604_800],
    ['day', 86_400], ['hour', 3_600], ['minute', 60],
  ]
  for (const [unit, span] of units) {
    if (Math.abs(seconds) >= span) return relative.format(Math.round(seconds / span), unit)
  }
  return relative.format(seconds, 'second')
}

/**
 * One page of the owner's activity. Keyed by page so changing pages remounts it
 * (the list scrolls back to the top), and state is only written from the fetch
 * callback — never synchronously in the effect body.
 */
function ActivityPage({ page, onTotal }: { page: number; onTotal: (total: number) => void }) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetchActivity(PAGE_SIZE, (page - 1) * PAGE_SIZE)
      .then((data) => { if (alive) { setRows(data.rows); onTotal(data.total) } })
      .catch(() => { if (alive) { setRows([]); setError('Could not load your activity.') } })
    return () => { alive = false }
  }, [page, onTotal])

  if (rows === null) return <p className="mr-cfg-note" role="status">Loading activity…</p>
  if (error) return <p className="mr-cfg-error" role="alert">{error}</p>
  if (!rows.length) {
    return (
      <div className="mr-cfg-gate">
        <p className="mr-cfg-gate-title">No completed work yet</p>
        <p className="mr-cfg-gate-hint">Once you convert a document while signed in, it appears here.</p>
      </div>
    )
  }

  return (
    <ul className="mr-cfg-log">
      {rows.map((row, index) => (
        <li key={`${row.created_at}-${index}`} className="mr-cfg-log-row">
          <span className="mr-cfg-log-mark" aria-hidden="true" />
          <span className="mr-cfg-log-body">
            <strong>{row.tool_label}</strong>
            <small title={row.file_name ?? undefined}>{row.file_name ?? 'No file name recorded'}</small>
          </span>
          <time className="mr-cfg-log-time" dateTime={row.created_at}>{timeAgo(row.created_at)}</time>
        </li>
      ))}
    </ul>
  )
}

/**
 * Activity — the owner's own success-only run log, read from the shared
 * `/api/profile/activity` route (the only other piece of shared data the console
 * borrows besides identity; plan §8.1). Only completed conversions appear, so
 * the log never shows work that did not happen.
 */
export default function ActivitySection({ ctx }: { ctx: SettingsContext }) {
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (!ctx.viewer) {
    return (
      <section className="mr-cfg-section">
        <PaneHead eyebrow="Account" title="Activity" hint="Completed runs on this account." />
        <p className="mr-cfg-note">Sign in to see the conversions recorded on your account.</p>
      </section>
    )
  }

  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const last = Math.min(page * PAGE_SIZE, total)

  return (
    <section className="mr-cfg-section">
      <PaneHead eyebrow="Account" title="Activity" hint="Completed conversions on this account. Only successful runs appear." />

      <ActivityPage key={page} page={page} onTotal={setTotal} />

      <div className="mr-cfg-pager">
        <span className="mr-cfg-pager-count">
          {total === 0 ? 'Nothing recorded' : `${first}–${last} of ${total}`}
        </span>
        {totalPages > 1 ? (
          <nav className="mr-cfg-pager-nav" aria-label="Activity pages">
            <button type="button" className="mr-cfg-pager-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <span className="mr-cfg-pager-page">{page} / {totalPages}</span>
            <button type="button" className="mr-cfg-pager-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} aria-label="Next page">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </nav>
        ) : null}
      </div>
    </section>
  )
}
