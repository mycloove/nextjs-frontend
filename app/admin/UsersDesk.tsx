'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import BenchIcon from './BenchIcon'
import { BenchToasts, useBenchToasts } from './BenchToast'
import { ConfirmDialog, type ConfirmSpec } from './ConfirmDialog'
import { count } from './format'
import styles from './bench.module.css'

export type UsersTab = 'accounts' | 'browsers'

type Row = {
  id: string
  primary: string
  sub: string
  kind: 'account' | 'browser'
  active?: boolean
  created: string
  calls_24h: number
  calls_total: number
}

const PAGE_SIZE = 25

/**
 * The bench's people desk. Its question is never "what did this person convert"
 * — no table records that — but "how hard is this identity leaning on its cap".
 * The counters are therefore per identity across every tool, shown as raw counts
 * rather than a percentage, because there is no single cap to divide by: each
 * instrument has its own, and the honest reading is the number itself.
 */
export default function UsersDesk({
  tab,
  query,
  page,
  accounts,
  accountTotal,
  browsers,
  browserTotal,
  loadError,
  canEditUsers,
}: {
  tab: UsersTab
  query: string
  page: number
  accounts: Row[]
  accountTotal: number
  browsers: Row[]
  browserTotal: number
  loadError: string
  canEditUsers: boolean
}) {
  const [ask, setAsk] = useState<ConfirmSpec | null>(null)
  const [pending, setPending] = useState<Row | null>(null)
  const [busyId, setBusyId] = useState('')
  const [statusOverride, setStatusOverride] = useState<Record<string, boolean>>({})
  const { toasts, push, dismiss } = useBenchToasts()
  const router = useRouter()

  const rows = tab === 'accounts' ? accounts : browsers
  const total = tab === 'accounts' ? accountTotal : browserTotal
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const askClear = (row: Row) => {
    setAsk({
      eyebrow: row.kind === 'browser' ? 'Clear a browser tally' : 'Clear an account tally',
      title: `Clear every recorded call for ${row.primary}?`,
      body:
        row.kind === 'browser'
          ? 'This browser only exists as a cookie id, so nothing else is kept about it. Clearing the tally returns its caps immediately, across every tool.'
          : 'Their caps return immediately, across every tool, and their conversion history stops counting. The account, its sign-in and its role are untouched.',
      facts: [
        { label: 'Recorded · 24h', value: count(row.calls_24h) },
        { label: 'Recorded · all time', value: count(row.calls_total) },
      ],
      cancelLabel: 'Keep the tally',
      confirmLabel: 'Clear calls',
      tone: 'danger',
      typeToConfirm: 'CLEAR',
    })
    setPending(row)
  }

  const dismissAsk = () => {
    setAsk(null)
    setPending(null)
  }

  const runClear = async () => {
    if (!pending) return
    setAsk((current) => (current ? { ...current, busy: true } : current))
    setBusyId(pending.id)
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          pending.kind === 'browser' ? { anon_id: pending.id } : { user_id: pending.id },
        ),
      })
      const payload = await response.json() as { deleted?: number; error?: string }
      if (!response.ok) throw new Error(payload.error || 'Could not clear those calls')
      const removed = payload.deleted ?? 0
      push(
        'ok',
        `Cleared ${removed} recorded call${removed === 1 ? '' : 's'} for ${pending.primary}.`,
      )
      setAsk(null)
      setPending(null)
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'Could not clear those calls')
    } finally {
      setBusyId('')
    }
  }

  const toggleActive = async (row: Row) => {
    const nextActive = !(statusOverride[row.id] ?? row.active)
    setBusyId(row.id)
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: row.id, active: nextActive }),
      })
      const payload = await response.json() as { active?: boolean; error?: string }
      if (!response.ok) throw new Error(payload.error || 'Could not change that account')
      const applied = payload.active ?? nextActive
      setStatusOverride((prev) => ({ ...prev, [row.id]: applied }))
      push('ok', `${row.primary} is now ${applied ? 'active' : 'turned off'}.`)
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'Could not change that account')
    } finally {
      setBusyId('')
    }
  }

  const pageHref = (next: number) => hrefFor(tab, query, next)

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <p className={styles.pageEyebrow}>Users</p>
          <h1 className={styles.pageTitle}>Who is using the tools, and how hard.</h1>
          <p className={styles.pageLead}>
            Counters are per identity across every instrument. There is no per-person conversion history in this
            deployment — only calls counted against a rolling window, which is what decides whether the next one
            is allowed.
          </p>
        </div>
        <div className={styles.pageActions}>
          <a className={styles.btn} href={`/api/admin/export?dataset=${tab === 'accounts' ? 'users' : 'browsers'}${query ? `&q=${encodeURIComponent(query)}` : ''}`}>
            Export CSV
          </a>
        </div>
      </header>

      {loadError ? (
        <div className={styles.degraded} role="status">
          <BenchIcon className={styles.toastIcon} name="alert" />
          <div>
            <p className={styles.degradedTitle}>The list could not be read.</p>
            <p className={styles.degradedBody}>{loadError}</p>
          </div>
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <form className={styles.search} action="/admin/users" method="get">
          <BenchIcon className={styles.navIcon} name="search" />
          <input
            className={styles.searchInput}
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search by email, or paste a full account id…"
            aria-label="Search accounts"
          />
          <input type="hidden" name="tab" value={tab} />
          <button type="submit" className={styles.btnIcon} aria-label="Search">
            <BenchIcon className={styles.navIcon} name="next" />
          </button>
        </form>
        <div className={styles.segmented} role="group" aria-label="Choose a list">
          <button
            type="button"
            className={`${styles.segment} ${tab === 'accounts' ? styles.segmentOn : ''}`}
            aria-pressed={tab === 'accounts'}
            onClick={() => router.push(hrefFor('accounts', query))}
          >
            Accounts<span className={styles.segmentCount}>{count(accountTotal)}</span>
          </button>
          <button
            type="button"
            className={`${styles.segment} ${tab === 'browsers' ? styles.segmentOn : ''}`}
            aria-pressed={tab === 'browsers'}
            onClick={() => router.push(hrefFor('browsers', query))}
          >
            Browsers<span className={styles.segmentCount}>{count(browserTotal)}</span>
          </button>
        </div>
        <span className={styles.spacer} />
        <span className={styles.pagerNote}>
          {total === 0 ? 'Nothing recorded' : `${count(total)} ${tab === 'accounts' ? 'accounts' : 'browsers'}`}
        </span>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>{tab === 'accounts' ? 'Accounts' : 'Browsers'}</h2>
          <p className={styles.panelNote}>
            {tab === 'accounts'
              ? 'Signed in. Their role and sign-in are on the Admins desk.'
              : 'No account, only a cookie id. Listed by recorded call volume.'}
          </p>
        </div>

        {rows.length === 0 ? (
          <div className={styles.empty}>
            <h3 className={styles.emptyTitle}>{query ? 'Nobody matches that search.' : 'Nothing recorded yet.'}</h3>
            <p className={styles.emptyBody}>
              {query
                ? 'Clear the search box to see the whole list.'
                : 'Once a conversion route is called, its identity shows up here with the calls it has made in the last day.'}
            </p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Identity</th>
                  <th className={styles.th}>{tab === 'accounts' ? 'Status' : 'Type'}</th>
                  <th className={styles.th}>Recorded · 24h</th>
                  <th className={styles.th}>Recorded · total</th>
                  {canEditUsers ? <th className={styles.th} style={{ textAlign: 'right' }}>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const busy = busyId === row.id
                  return (
                    <tr key={row.id} className={styles.tr}>
                      <td className={styles.td}>
                        <div className={styles.cellStack}>
                          <span className={`${styles.cellPrimary} ${row.kind === 'browser' ? styles.cellMuted : ''}`}>
                            {row.primary}
                          </span>
                          <span className={styles.cellSub}>{row.sub}</span>
                          {row.kind === 'account' ? (
                            <Link className={styles.featureLink} href={`/admin/analytics?user=${encodeURIComponent(row.id)}`}>
                              Feature use <BenchIcon className={styles.navIcon} name="next" />
                            </Link>
                          ) : null}
                        </div>
                      </td>
                      <td className={styles.td}>
                        <span
                          className={`${styles.badge} ${
                            row.kind === 'browser'
                              ? styles.badgeNeutral
                              : (statusOverride[row.id] ?? row.active)
                                ? styles.badgeOn
                                : styles.badgeOff
                          }`}
                        >
                          {row.kind === 'browser'
                            ? 'Browser'
                            : (statusOverride[row.id] ?? row.active)
                              ? 'Signed in'
                              : 'Turned off'}
                        </span>
                      </td>
                      <td className={`${styles.td} ${styles.cellNum}`}>{count(row.calls_24h)}</td>
                      <td className={`${styles.td} ${styles.cellNum}`}>{count(row.calls_total)}</td>
                      {canEditUsers ? <td className={`${styles.td} ${styles.cellRight}`}>
                        {row.kind === 'account' ? (
                          <button
                            type="button"
                            className={styles.btn}
                            onClick={() => toggleActive(row)}
                            disabled={busy}
                            title={(statusOverride[row.id] ?? row.active) ? 'Withdraw this account’s access' : 'Restore this account’s access'}
                          >
                            {(statusOverride[row.id] ?? row.active) ? 'Turn off' : 'Turn on'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnDanger}`}
                          onClick={() => askClear(row)}
                          disabled={busy}
                          title="Clear this identity's recorded calls on every tool"
                        >
                          Clear calls
                        </button>
                      </td> : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 ? (
          <div className={styles.pager}>
            <span className={styles.pagerNote}>
              Page {page} of {totalPages}
            </span>
            <span className={styles.cardActions}>
              <Link
                className={`${styles.btn} ${styles.pagerControl} ${page <= 1 ? styles.pagerControlDisabled : ''}`}
                href={pageHref(page - 1)}
                aria-disabled={page <= 1}
                tabIndex={page <= 1 ? -1 : undefined}
                onClick={(event) => { if (page <= 1) event.preventDefault() }}
              >
                <BenchIcon className={styles.navIcon} name="prev" />
                Previous
              </Link>
              <Link
                className={`${styles.btn} ${styles.pagerControl} ${page >= totalPages ? styles.pagerControlDisabled : ''}`}
                href={pageHref(page + 1)}
                aria-disabled={page >= totalPages}
                tabIndex={page >= totalPages ? -1 : undefined}
                onClick={(event) => { if (page >= totalPages) event.preventDefault() }}
              >
                Next
                <BenchIcon className={styles.navIcon} name="next" />
              </Link>
            </span>
          </div>
        ) : null}
      </div>

      <ConfirmDialog spec={ask} onCancel={dismissAsk} onConfirm={() => void runClear()} />
      <BenchToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

/** Kept in one place so the tab buttons, the search form and the pager agree. */
function hrefFor(tab: UsersTab, query: string, page = 1) {
  const params = new URLSearchParams()
  params.set('tab', tab)
  if (query) params.set('q', query)
  if (page > 1) params.set('p', String(page))
  return `/admin/users?${params.toString()}`
}
