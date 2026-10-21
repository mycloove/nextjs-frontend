import { adminEntryRedirect, requireAdmin } from '@/lib/usage/admin'
import { readAdminStoreStatus } from '@/lib/usage/controls'
import { microserviceFetch } from '@/lib/usage/internal'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import BenchIcon from '../BenchIcon'
import { count } from '../format'
import styles from '../bench.module.css'

export const metadata: Metadata = {
  title: 'Settings',
  description: 'What this deployment has configured, and what the bench will do when it cannot read its store.',
}

/** Whether a secret exists, never its value — this page is admin-gated but still rendered. */
const flag = (name: string) => Boolean(process.env[name])

type Row = {
  name: string
  detail: string
  state: 'ok' | 'warn' | 'off'
  label: string
}

function StatusTable({ title, note, rows }: { title: string; note: string; rows: Row[] }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{title}</h2>
        <p className={styles.panelNote}>{note}</p>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className={styles.tr}>
                <td className={styles.td}>
                  <div className={styles.cellStack}>
                    <span className={styles.cellPrimary}>{row.name}</span>
                    <span className={styles.cellSub}>{row.detail}</span>
                  </div>
                </td>
                <td className={`${styles.td} ${styles.cellRight}`}>
                  <span
                    className={`${styles.badge} ${
                      row.state === 'ok' ? styles.badgeOn : row.state === 'warn' ? styles.badgeDraft : styles.badgeOff
                    }`}
                  >
                    {row.label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default async function AdminSettingsPage() {
  const gate = await requireAdmin()
  const entry = adminEntryRedirect(gate)
  if (entry) redirect(entry)

  const store = await readAdminStoreStatus()
  const controller = new AbortController()
  const healthTimeout = setTimeout(() => controller.abort(), 2500)
  let serviceReachable = false
  let serviceStatus = 'The conversion service did not answer within 2.5 seconds.'
  try {
    const response = await microserviceFetch('/health', { signal: controller.signal, cache: 'no-store' })
    serviceReachable = response.ok
    serviceStatus = response.ok
      ? 'The conversion service health endpoint answered successfully.'
      : `The service answered with HTTP ${response.status}.`
  } catch {
    serviceStatus = 'The service health endpoint could not be reached.'
  } finally {
    clearTimeout(healthTimeout)
  }

  const storeRows: Row[] = [
    {
      name: 'DATABASE_URL',
      detail: store.env_set
        ? 'The environment variable is present.'
        : 'Not set. Nothing will be counted, and quota fails open so every tool runs uncapped.',
      state: store.env_set ? 'ok' : 'off',
      label: store.env_set ? 'Set' : 'Missing',
    },
    {
      name: 'Connection',
      detail: store.reachable
        ? 'The database accepted a connection from this server.'
        : store.message || 'The database did not answer.',
      state: store.reachable ? 'ok' : 'off',
      label: store.reachable ? 'Reachable' : 'Not reachable',
    },
    {
      name: 'Tables',
      detail: store.tables_present
        ? 'The usage migration has been applied.'
        : store.env_set
          ? store.message
          : 'Cannot be checked until DATABASE_URL is set.',
      state: store.tables_present ? 'ok' : 'off',
      label: store.tables_present ? 'Present' : 'Missing',
    },
    {
      name: 'Rows on file',
      detail: store.tables_present
        ? `${count(store.counts.users)} accounts · ${count(store.counts.tools)} instruments · ${count(store.counts.usages)} recorded calls`
        : 'Not readable until the tables exist.',
      state: store.tables_present ? 'ok' : 'warn',
      label: store.tables_present ? 'Counted' : 'Unknown',
    },
  ]

  const authRows: Row[] = [
    {
      name: 'First admin seat',
      detail: flag('ADMIN_BOOTSTRAP_TOKEN')
        ? 'The bootstrap window is sealed by a token: while no admin exists, seating the first one also needs the x-bootstrap-token header.'
        : 'There is no bootstrap token in this deployment. The very first seat is open to whoever reaches /admin while no admin exists, and it closes by seating one. Set ADMIN_BOOTSTRAP_TOKEN before the deployment goes live.',
      state: flag('ADMIN_BOOTSTRAP_TOKEN') ? 'ok' : 'warn',
      label: flag('ADMIN_BOOTSTRAP_TOKEN') ? 'Sealed' : 'Seal it',
    },
    {
      name: 'Service role key',
      detail: flag('SUPABASE_SERVICE_ROLE_KEY')
        ? 'Present. Seating and deleting an admin can reach Supabase Auth.'
        : 'Not set. The bench can list admins but cannot seat or delete one — Supabase Auth does the password hash.',
      state: flag('SUPABASE_SERVICE_ROLE_KEY') ? 'ok' : 'off',
      label: flag('SUPABASE_SERVICE_ROLE_KEY') ? 'Set' : 'Missing',
    },
    {
      name: 'Publishable key',
      detail: flag('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
        ? 'Present. The browser can sign people in.'
        : 'Not set. Nobody can sign in, so the bench itself will refuse to open.',
      state: flag('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ? 'ok' : 'off',
      label: flag('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ? 'Set' : 'Missing',
    },
  ]

  const serviceUrl = process.env.PDF_MICROSERVICE_URL || ''
  const serviceRows: Row[] = [
    {
      name: 'Live health check',
      detail: serviceStatus,
      state: serviceReachable ? 'ok' : 'off',
      label: serviceReachable ? 'Healthy' : 'Unreachable',
    },
    {
      name: 'Conversion service URL',
      detail: serviceUrl
        ? `PDF_MICROSERVICE_URL is set to ${serviceUrl}.`
        : 'PDF_MICROSERVICE_URL is not set, so routes fall back to http://localhost:5001 — while Compose maps the Flask service to 5000. Set it explicitly outside local development.',
      state: serviceUrl ? 'ok' : 'warn',
      label: serviceUrl ? 'Set' : 'Default',
    },
    {
      name: 'Service key',
      detail: flag('PDF_SERVICE_INTERNAL_KEY')
        ? 'Present. Routes can authenticate their calls to the conversion service.'
        : 'Not set. Conversion routes that call the backend will be rejected by it.',
      state: flag('PDF_SERVICE_INTERNAL_KEY') ? 'ok' : 'off',
      label: flag('PDF_SERVICE_INTERNAL_KEY') ? 'Set' : 'Missing',
    },
  ]

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <p className={styles.pageEyebrow}>Settings</p>
          <h1 className={styles.pageTitle}>What this deployment is running on.</h1>
          <p className={styles.pageLead}>
            Read-only by design. The bench has no stored configuration to change — caps, windows and on/off
            live on the Tools desk, and everything below is set in the environment and read from it. This page
            reports what is actually there, so nothing here can be saved and quietly forgotten.
          </p>
        </div>
      </header>

      {!store.env_set || !store.reachable || !store.tables_present ? (
        <div className={styles.degraded} role="status">
          <BenchIcon className={styles.toastIcon} name="alert" />
          <div>
            <p className={styles.degradedTitle}>The quota store is not healthy, so tools are running uncapped.</p>
            <p className={styles.degradedBody}>
              {store.message || 'Fix the row above, then reload.'} Quota fails open on purpose, which means
              conversions keep working without a limit until the store answers.
            </p>
          </div>
        </div>
      ) : null}

      <StatusTable
        title="Quota store"
        note="Reads and writes every cap, window and tally."
        rows={storeRows}
      />

      <StatusTable
        title="Accounts"
        note="Secrets are reported as present or absent only — never their values."
        rows={authRows}
      />

      <StatusTable
        title="Conversion service"
        note="Where the tool routes send the actual work."
        rows={serviceRows}
      />

      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Additional controls</h2>
          <p className={styles.panelNote}>Audit history is available; retention and per-account limits still need policy decisions.</p>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <tbody>
              {[
                {
                  name: 'Usage event retention',
                  detail:
                    'Recorded calls are kept until something deletes them. There is no pruning job and no retention window to set, so the usages table grows with traffic.',
                },
                {
                  name: 'Change history',
                  detail:
                    'Successful admin changes record the actor, target, request id, and before/after values.',
                  href: '/admin/audit',
                },
                {
                  name: 'AI providers',
                  detail:
                    'Cloud providers and encrypted keys for Document AI and the AI Analyzer. Without a usable chain, the AI tools fall back to the environment keys.',
                  href: '/admin/ai',
                },
                {
                  name: 'Per-account quota overrides',
                  detail:
                    'Caps are per tool for everyone. A single account cannot be given more than the rest, because nothing in the store records a per-person allowance.',
                },
              ].map((row) => (
                <tr key={row.name} className={styles.tr}>
                  <td className={styles.td}>
                    <div className={styles.cellStack}>
                      <span className={styles.cellPrimary}>{row.name}</span>
                      <span className={styles.cellSub}>{row.detail}</span>
                    </div>
                  </td>
                  <td className={styles.td}>
                    {'href' in row && row.href
                      ? <Link className={styles.btn} href={row.href}>Open</Link>
                      : <span className={`${styles.badge} ${styles.badgeNeutral}`}>Not available</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
