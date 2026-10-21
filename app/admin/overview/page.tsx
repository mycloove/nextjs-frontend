import { adminEntryRedirect, requireAdmin } from '@/lib/usage/admin'
import { readAdminOverview } from '@/lib/usage/controls'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import BenchIcon from '../BenchIcon'
import { count } from '../format'
import styles from '../bench.module.css'
import view from './overview.module.css'

export const metadata: Metadata = {
  title: 'Overview',
  description: 'Instrument state, seats, and call volume across the bench.',
}

/**
 * Everything on this page is read from the existing usage tables. There is no
 * audit log to show because no table records one — inventing a panel that implied
 * change history the deployment does not have would be the one thing this surface
 * must never do. The withdrawn list takes its place, because it is the same
 * question asked of data the bench actually owns.
 */
export default async function AdminOverviewPage() {
  const gate = await requireAdmin()
  const entry = adminEntryRedirect(gate)
  if (entry) redirect(entry)
  if (!gate.ok) {
    return (
      <div className={styles.page}>
        <header className={styles.pageHead}>
          <div>
            <p className={styles.pageEyebrow}>Overview</p>
            <h1 className={styles.pageTitle}>The bench is unavailable.</h1>
            <p className={styles.pageLead}>{gate.message ?? 'Set DATABASE_URL and run the migration, then reload.'}</p>
          </div>
        </header>
      </div>
    )
  }

  const read = await readAdminOverview()
  const data = read.data
  const open = data.tools_total > 0 && data.tools_open === data.tools_total

  return (
    <div className={`${styles.page} ${view.overviewPage}`}>
      <header className={`${styles.pageHead} ${view.overviewHeader}`}>
        <div className={view.intro}>
          <p className={styles.pageEyebrow}>Overview</p>
          <h1 className={`${styles.pageTitle} ${view.title}`}>System overview</h1>
          <p className={`${styles.pageLead} ${view.lead}`}>
            Tool availability, admin access, and completed usage at a glance.
          </p>
          <p className={view.method}>
            Only successful conversions count; failed conversions release their quota slot.
          </p>
        </div>
        <div className={styles.pageActions}>
          <Link className={styles.btn} href="/admin/tools">
            Manage tools
          </Link>
        </div>
      </header>

      {read.degraded ? (
        <div className={styles.degraded} role="status">
          <BenchIcon className={styles.toastIcon} name="alert" />
          <div>
            <p className={styles.degradedTitle}>The store could not be read, so these numbers are not real.</p>
            <p className={styles.degradedBody}>
              {read.message} Quota fails open when the store is missing — every tool is accepting calls, uncapped,
              right now. Set <code>DATABASE_URL</code>, run <code>npx prisma migrate deploy</code> in
              nextjs-frontend, then reload.
            </p>
          </div>
        </div>
      ) : null}

      <div className={`${styles.stats} ${view.metrics}`}>
        <div className={`${styles.stat} ${view.metric}`}>
          <p className={`${styles.statLabel} ${view.metricLabel}`}>Instruments</p>
          <p className={`${styles.statValue} ${view.metricValue}`}>
            {count(data.tools_open)}
            <span className={styles.statSub}>/ {count(data.tools_total)} open</span>
          </p>
        </div>
        <div className={`${styles.stat} ${view.metric} ${data.admins_active === 0 ? styles.statAlert : ''}`}>
          <p className={`${styles.statLabel} ${view.metricLabel}`}>Admin seats</p>
          <p className={`${styles.statValue} ${view.metricValue}`}>
            {count(data.admins_active)}
            <span className={styles.statSub}>/ {count(data.admins_total)} active</span>
          </p>
        </div>
        <div className={`${styles.stat} ${view.metric}`}>
          <p className={`${styles.statLabel} ${view.metricLabel}`}>Calls · 24 hours</p>
          <p className={`${styles.statValue} ${view.metricValue}`}>
            {count(data.calls_24h)}
            <span className={styles.statSub}>completed</span>
          </p>
        </div>
        <div className={`${styles.stat} ${view.metric}`}>
          <p className={`${styles.statLabel} ${view.metricLabel}`}>Calls · 7 days</p>
          <p className={`${styles.statValue} ${view.metricValue}`}>
            {count(data.calls_7d)}
            <span className={styles.statSub}>completed</span>
          </p>
        </div>
        <div className={`${styles.stat} ${view.metric}`}>
          <p className={`${styles.statLabel} ${view.metricLabel}`}>Accounts</p>
          <p className={`${styles.statValue} ${view.metricValue}`}>
            {count(data.accounts_total)}
            <span className={styles.statSub}>{count(data.accounts_active)} can sign in</span>
          </p>
        </div>
        <div className={`${styles.stat} ${view.metric}`}>
          <p className={`${styles.statLabel} ${view.metricLabel}`}>Browsers · 24 hours</p>
          <p className={`${styles.statValue} ${view.metricValue}`}>
            {count(data.guests_24h)}
            <span className={styles.statSub}>distinct anon ids</span>
          </p>
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>Withdrawn instruments</h2>
            <p className={styles.panelNote}>Disabled tools are hidden from the homepage and blocked at their route.</p>
          </div>
        </div>
        {data.withdrawn.length === 0 ? (
          <div className={styles.empty}>
            <h3 className={styles.emptyTitle}>{open ? 'Every instrument is open.' : 'Nothing to show here.'}</h3>
            <p className={styles.emptyBody}>
              {data.tools_total === 0
                ? 'The tool store could not be read, so the bench does not know what exists.'
                : 'No tool has been withdrawn. All of them accept calls on their saved caps.'}
            </p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Instrument</th>
                  <th className={styles.th}>Route</th>
                  <th className={styles.th}>Caps on file</th>
                </tr>
              </thead>
              <tbody>
                {data.withdrawn.map((tool) => (
                  <tr key={tool.tool_id} className={styles.tr}>
                    <td className={styles.td}>
                      <span className={styles.cellPrimary}>{tool.label}</span>
                    </td>
                    <td className={`${styles.td} ${styles.cellSubMono}`}>{tool.href}</td>
                    <td className={`${styles.td} ${styles.cellNum}`}>
                      {tool.guest_limit} guest · {tool.member_limit} signed in · per {tool.period === 'week' ? 'week' : 'day'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Deployment checks</h2>
          <p className={styles.panelNote}>Current conditions to check before making changes.</p>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <tbody>
              <tr className={styles.tr}>
                <td className={styles.td}>
                  <div className={styles.cellStack}>
                    <span className={styles.cellPrimary}>
                      {data.admins_total === 0 ? 'No admin is seated' : 'Admin seats are seated'}
                    </span>
                    <span className={styles.cellSub}>
                      {data.admins_total === 0
                        ? 'The first seat is open to anyone who reaches /admin — seat one before the deployment goes live.'
                        : `${data.admins_total} seat${data.admins_total === 1 ? '' : 's'} can open the bench.`}
                    </span>
                  </div>
                </td>
                <td className={styles.td}>
                  <span className={`${styles.badge} ${data.admins_total === 0 ? styles.badgeOff : styles.badgeOn}`}>
                    {data.admins_total === 0 ? 'Open' : 'Sealed'}
                  </span>
                </td>
              </tr>
              <tr className={styles.tr}>
                <td className={styles.td}>
                  <div className={styles.cellStack}>
                    <span className={styles.cellPrimary}>Quota enforcement</span>
                    <span className={styles.cellSub}>
                      {read.degraded
                        ? 'The store is unreachable. Quota fails open, so tools accept calls with no cap until it returns.'
                        : 'The store is answering, so caps are enforced on every conversion route.'}
                    </span>
                  </div>
                </td>
                <td className={styles.td}>
                  <span className={`${styles.badge} ${read.degraded ? styles.badgeOff : styles.badgeOn}`}>
                    {read.degraded ? 'Failing open' : 'Enforcing'}
                  </span>
                </td>
              </tr>
              <tr className={styles.tr}>
                <td className={styles.td}>
                  <div className={styles.cellStack}>
                    <span className={styles.cellPrimary}>Most recent activity</span>
                    <span className={styles.cellSub}>
                      {data.calls_24h > 0 ? `${count(data.calls_24h)} calls in the last 24 hours` : 'No calls recorded in the last 24 hours'}
                    </span>
                  </div>
                </td>
                <td className={styles.td}>
                  <span className={`${styles.badge} ${data.calls_24h > 0 ? styles.badgeOn : styles.badgeNeutral}`}>
                    {data.calls_24h > 0 ? 'Active' : 'Quiet'}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className={styles.panelNote}>
        Quota windows roll continuously; a full cap may free a slot as older calls leave the window.
      </p>
    </div>
  )
}
