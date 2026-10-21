import { adminEntryRedirect, requireAdmin } from '@/lib/usage/admin'
import { readAdminFeatureUsageAnalytics } from '@/lib/usage/controls'
import { TOOL_CATALOG } from '@/lib/usage/catalog'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import BenchIcon from '../BenchIcon'
import { shortId } from '../format'
import styles from '../bench.module.css'
import view from './analytics.module.css'

export const metadata: Metadata = { title: 'Feature use', description: 'Successful feature use by account.' }
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default async function AdminAnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string; user?: string }> }) {
  const gate = await requireAdmin()
  const entry = adminEntryRedirect(gate)
  if (entry) redirect(entry)
  if (!gate.ok) return <div className={styles.page}><h1 className={styles.pageTitle}>Feature analytics unavailable.</h1></div>

  const params = await searchParams
  const days = ['7', '30', '90'].includes(params.days ?? '') ? Number(params.days) : 30
  const userId = params.user && UUID_PATTERN.test(params.user) ? params.user : undefined
  // This is a request-time server component, so the rolling window must use the request's current time.
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - days * 86_400_000)
  const result = await readAdminFeatureUsageAnalytics({ since, userId })
  const labels = new Map(TOOL_CATALOG.map((tool) => [tool.tool_id, tool.label]))
  const max = Math.max(1, ...result.data.rows.map((row) => row.successful_uses))
  const top = result.data.rows[0]

  return <div className={`${styles.page} ${view.analyticsPage}`}>
    <header className={`${styles.pageHead} ${view.header}`}>
      <div className={view.intro}>
        <p className={styles.pageEyebrow}>Feature use</p>
        <h1 className={styles.pageTitle}>{userId ? 'Account activity' : 'Usage overview'}</h1>
        <p className={`${styles.pageLead} ${view.lead}`}>Successful tool actions from signed-in accounts.</p>
        <p className={view.privacy}>Failed requests and anonymous use are excluded. File names remain visible only to their owner; this desk never reads them. File contents and prompts are not stored.</p>
        {userId ? <p className={view.account}>{result.data.user?.email ?? 'Account'} <span aria-hidden="true">·</span> <span className={view.accountId}>{shortId(userId)}</span></p> : null}
      </div>
      <form className={view.filters} action="/admin/analytics" method="get">
        {userId ? <input type="hidden" name="user" value={userId} /> : null}
        <label className={`${styles.fieldLabel} ${view.filterLabel}`} htmlFor="analytics-days">Window</label>
        <select id="analytics-days" name="days" className={`${styles.select} ${view.filterSelect}`} defaultValue={String(days)}>
          <option value="7">7 days</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
        </select>
        <button type="submit" className={`${styles.btn} ${view.apply}`}>Apply</button>
      </form>
    </header>

    {result.degraded ? <div className={styles.degraded} role="status"><BenchIcon className={styles.toastIcon} name="alert" /><div><p className={styles.degradedTitle}>Feature events are not available yet.</p><p className={styles.degradedBody}>{result.message}</p></div></div> : null}
    {params.user && !userId ? <div className={styles.degraded} role="status"><div><p className={styles.degradedTitle}>That account id is invalid.</p></div></div> : null}

    <section className={`${styles.stats} ${view.summary}`} aria-label="Feature use summary">
      <article className={`${styles.stat} ${view.summaryItem}`}>
        <p className={`${styles.statLabel} ${view.summaryLabel}`}>Successful actions</p>
        <p className={`${styles.statValue} ${view.summaryValue}`}>{result.data.total.toLocaleString()}</p>
        <p className={styles.statSub}>in the last {days} days</p>
      </article>
      <article className={`${styles.stat} ${view.summaryItem}`}>
        <p className={`${styles.statLabel} ${view.summaryLabel}`}>Most used</p>
        <p className={`${styles.statValue} ${view.topFeature}`}>{top ? labels.get(top.tool_id) ?? top.tool_id : '—'}</p>
        <p className={styles.statSub}>{top ? `${top.successful_uses.toLocaleString()} successful actions` : 'No activity in this window'}</p>
      </article>
      <article className={`${styles.stat} ${view.summaryItem}`}>
        <p className={`${styles.statLabel} ${view.summaryLabel}`}>Features used</p>
        <p className={`${styles.statValue} ${view.summaryValue}`}>{result.data.rows.length.toLocaleString()}</p>
        <p className={styles.statSub}>distinct tools with activity</p>
      </article>
    </section>

    <section className={`${styles.panel} ${view.ranking}`}>
      <div className={`${styles.panelHead} ${view.rankingHead}`}>
        <h2 className={styles.panelTitle}>Feature ranking</h2>
        <p className={styles.panelNote}>Bar length relative to the top feature</p>
      </div>
      {result.data.rows.length === 0 ? <div className={styles.empty}><h3 className={styles.emptyTitle}>{result.degraded ? 'No feature data to show.' : 'No successful actions recorded yet.'}</h3><p className={styles.emptyBody}>Events start after the feature analytics migration is deployed.</p></div> :
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th className={styles.th}>Rank</th><th className={styles.th}>Feature</th><th className={styles.th}>Usage</th><th className={styles.th} style={{ textAlign: 'right' }}>Successful actions</th></tr></thead><tbody>
          {result.data.rows.map((row, index) => <tr key={row.tool_id} className={styles.tr}>
            <td className={`${styles.td} ${styles.cellSubMono} ${view.rank}`}>{String(index + 1).padStart(2, '0')}</td>
            <td className={`${styles.td} ${view.feature}`}>{labels.get(row.tool_id) ?? row.tool_id}</td>
            <td className={`${styles.td} ${view.usageCell}`}><div className={view.usageMeter} aria-label={`${Math.round(row.successful_uses / max * 100)} percent of top feature use`}><span className={view.usageFill} style={{ width: `${Math.max(3, row.successful_uses / max * 100)}%` }} /></div></td>
            <td className={`${styles.td} ${styles.cellNum} ${view.count}`}>{row.successful_uses.toLocaleString()}</td>
          </tr>)}
        </tbody></table></div>}
    </section>
  </div>
}
