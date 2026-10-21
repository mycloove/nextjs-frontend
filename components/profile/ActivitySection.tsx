'use client'

import { useEffect, useState } from 'react'
import { fetchActivity, type ActivityRow } from './profileApi'
import styles from './profile.module.css'

const PAGE_SIZE = 8

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const seconds = Math.round((then - Date.now()) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]
  for (const [unit, span] of units) {
    if (Math.abs(seconds) >= span) return relative.format(Math.round(seconds / span), unit)
  }
  return relative.format(seconds, 'second')
}

/** Windowed page numbers with ellipses, e.g. 1 … 4 5 6 … 12. */
function pageWindow(current: number, totalPages: number): (number | 'gap')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const pages: (number | 'gap')[] = [1]
  if (current > 4) pages.push('gap')
  for (let n = Math.max(2, current - 1); n <= Math.min(totalPages - 1, current + 1); n += 1) pages.push(n)
  if (current < totalPages - 3) pages.push('gap')
  pages.push(totalPages)
  return pages
}

/**
 * One page of activity rows. Keyed by page number so changing pages remounts
 * it — the list scrolls back to the top for free, and state is only ever written
 * from fetch callbacks (never synchronously in the effect body).
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

  return (
    <div className={styles.activityScroll}>
      {rows === null ? (
        <p className={styles.muted} role="status">Loading activity…</p>
      ) : error ? (
        <p className={styles.error} role="alert">{error}</p>
      ) : !rows.length ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No completed work yet</p>
          <p className={styles.emptyHint}>Once you convert a document while signed in, it will appear here.</p>
        </div>
      ) : (
        <ul className={styles.activityList}>
          {rows.map((row, index) => (
            <li key={`${row.created_at}-${index}`} className={styles.activityRow}>
              <span className={styles.activityDot} aria-hidden="true" />
              <div className={styles.activityBody}>
                <span className={styles.activityTool}>{row.tool_label}</span>
                <span className={styles.activityFile} title={row.file_name ?? undefined}>{row.file_name ?? 'No file name recorded'}</span>
              </div>
              <time className={styles.activityTime} dateTime={row.created_at}>{timeAgo(row.created_at)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The owner's own success-only activity: which tool ran, on what file, and when.
 * Only completed conversions appear — a failed attempt is never recorded, so the
 * list never shows work that did not actually happen.
 *
 * The header is a fixed flex sibling above the list and the pager a fixed sibling
 * below it; only the list scrolls, so the title, the modal's close control and
 * the pagination stay put. The modal body switches to this bounded layout for
 * this tab (see SettingsModal's modalBodyFixed / modalPaneFixed).
 */
export default function ActivitySection() {
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const go = (next: number) => {
    setPage(Math.min(Math.max(next, 1), totalPages))
  }

  return (
    <div className={styles.activitySection}>
      <div className={styles.activityHead}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>Activity</h3>
          <p className={styles.sectionHint}>Completed conversions on this account. Only successful runs appear.</p>
        </div>
      </div>

      <ActivityPage key={page} page={page} onTotal={setTotal} />

      <div className={styles.activityPager}>
        <span className={styles.pagerCount}>
          {total === 0 ? 'Nothing recorded' : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
        </span>
        {totalPages > 1 ? (
          <nav className={styles.pagerNav} aria-label="Activity pages">
            <button
              type="button"
              className={styles.pagerBtn}
              onClick={() => go(page - 1)}
              disabled={page <= 1}
              aria-label="Previous page"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            {pageWindow(page, totalPages).map((entry, index) => entry === 'gap' ? (
              <span key={`gap-${index}`} className={styles.pagerGap} aria-hidden="true">…</span>
            ) : (
              <button
                key={entry}
                type="button"
                className={`${styles.pagerBtn} ${entry === page ? styles.pagerBtnActive : ''}`}
                onClick={() => go(entry)}
                aria-current={entry === page ? 'page' : undefined}
              >
                {entry}
              </button>
            ))}
            <button
              type="button"
              className={styles.pagerBtn}
              onClick={() => go(page + 1)}
              disabled={page >= totalPages}
              aria-label="Next page"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </nav>
        ) : null}
      </div>
    </div>
  )
}
