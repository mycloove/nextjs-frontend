import { adminEntryRedirect, requireAdmin } from '@/lib/usage/admin'
import { readAdminAuditEvents } from '@/lib/usage/controls'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import BenchIcon from '../BenchIcon'
import { shortId } from '../format'
import styles from '../bench.module.css'

export const metadata: Metadata = {
  title: 'Audit log',
  description: 'A record of changes made from the admin bench.',
}

const PAGE_SIZE = 25
const ACTIONS = [
  ['admin.bootstrap.create', 'First owner created'],
  ['admin.seat.create', 'Team member added'],
  ['admin.seat.restore', 'Team member restored'],
  ['admin.seat.activate', 'Admin sign-in enabled'],
  ['admin.seat.deactivate', 'Admin sign-in disabled'],
  ['admin.seat.delete', 'Admin removed'],
  ['tool.control.update', 'Tool settings changed'],
  ['tool.usage.reset', 'Tool usage cleared'],
  ['usage.person.clear', 'Person usage cleared'],
  ['account.delete', 'Account deleted'],
] as const

function shortTime(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))
}

function pageHref(page: number, action: string) {
  const params = new URLSearchParams()
  if (action) params.set('action', action)
  if (page > 1) params.set('p', String(page))
  const query = params.toString()
  return `/admin/audit${query ? `?${query}` : ''}`
}

/**
 * Pager control for a Server Component. A disabled direction renders as a
 * plain <span> rather than a <Link> with an onClick guard: event handlers are
 * functions, and a Server Component cannot send one across the client boundary
 * (doing so throws as soon as this controls a real page). Rendering no link at
 * all is also the more correct disabled affordance — there is nothing to focus
 * or follow.
 */
function PagerControl({ href, disabled, children }: { href: string; disabled: boolean; children: ReactNode }) {
  const className = `${styles.btn} ${styles.pagerControl}${disabled ? ` ${styles.pagerControlDisabled}` : ''}`
  if (disabled) {
    return <span className={className} aria-disabled="true">{children}</span>
  }
  return <Link className={className} href={href}>{children}</Link>
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; p?: string }>
}) {
  const gate = await requireAdmin()
  const entry = adminEntryRedirect(gate)
  if (entry) redirect(entry)
  if (!gate.ok) {
    return <div className={styles.page}><h1 className={styles.pageTitle}>Audit log unavailable.</h1></div>
  }

  const params = await searchParams
  const action = ACTIONS.some(([value]) => value === params.action) ? params.action ?? '' : ''
  const parsedPage = Number.parseInt(params.p ?? '1', 10)
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const result = await readAdminAuditEvents({
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
    action: action || undefined,
  })
  const totalPages = Math.max(1, Math.ceil(result.data.total / PAGE_SIZE))

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <p className={styles.pageEyebrow}>Audit log</p>
          <h1 className={styles.pageTitle}>Changes made at the bench.</h1>
          <p className={styles.pageLead}>Successful admin changes are recorded with the actor, target, and before/after values. Secrets are never included.</p>
        </div>
        <div className={styles.pageActions}>
          <a className={styles.btn} href={`/api/admin/export?dataset=audit${action ? `&action=${encodeURIComponent(action)}` : ''}`}>
            Export CSV
          </a>
        </div>
      </header>

      {result.degraded ? (
        <div className={styles.degraded} role="status">
          <BenchIcon className={styles.toastIcon} name="alert" />
          <div><p className={styles.degradedTitle}>The audit table could not be read.</p><p className={styles.degradedBody}>{result.message}</p></div>
        </div>
      ) : null}

      <form className={styles.toolbar} action="/admin/audit" method="get">
        <label className={styles.fieldLabel} htmlFor="audit-action">Change type</label>
        <select id="audit-action" name="action" className={styles.select} defaultValue={action}>
          <option value="">All changes</option>
          {ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button type="submit" className={styles.btn}>Apply</button>
      </form>

      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Recorded changes</h2>
          <p className={styles.panelNote}>{result.data.total.toLocaleString()} total</p>
        </div>
        {result.data.rows.length === 0 ? (
          <div className={styles.empty}>
            <h3 className={styles.emptyTitle}>{result.degraded ? 'No audit entries are available.' : 'No changes recorded yet.'}</h3>
            <p className={styles.emptyBody}>{result.degraded ? 'Apply the audit migration, then reload.' : 'Successful admin changes will appear here.'}</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th className={styles.th}>When (UTC)</th><th className={styles.th}>Change</th><th className={styles.th}>Actor</th><th className={styles.th}>Target</th><th className={styles.th}>Values</th></tr></thead>
              <tbody>
                {result.data.rows.map((row) => (
                  <tr key={row.id} className={styles.tr}>
                    <td className={`${styles.td} ${styles.cellSubMono}`}>{shortTime(row.created_at)}</td>
                    <td className={styles.td}>{ACTIONS.find(([value]) => value === row.action)?.[1] ?? row.action}</td>
                    <td className={styles.td}><div className={styles.cellStack}><span className={styles.cellPrimary}>{row.actor_email ?? 'First-run bootstrap'}</span><span className={styles.cellSubMono}>{row.actor_id ? shortId(row.actor_id) : 'No signed-in actor'}</span></div></td>
                    <td className={styles.td}><div className={styles.cellStack}><span>{row.target_type}</span><span className={styles.cellSubMono}>{row.target_id ? shortId(row.target_id) : '—'}</span></div></td>
                    <td className={styles.td}>
                      <details className={styles.auditDetails}>
                        <summary>Inspect</summary>
                        <pre>{JSON.stringify({ before: row.before, after: row.after, request_id: row.request_id }, null, 2)}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 ? (
          <div className={styles.pager}>
            <span className={styles.pagerNote}>Page {page} of {totalPages}</span>
            <span className={styles.cardActions}>
              <PagerControl href={pageHref(page - 1, action)} disabled={page <= 1}>
                <BenchIcon className={styles.navIcon} name="prev" />Previous
              </PagerControl>
              <PagerControl href={pageHref(page + 1, action)} disabled={page >= totalPages}>
                Next<BenchIcon className={styles.navIcon} name="next" />
              </PagerControl>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
