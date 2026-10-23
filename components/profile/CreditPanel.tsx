import type { CreditBalanceState, CreditSnapshot } from '@/lib/usage/credit-types'
import styles from './profile.module.css'

const exactNumber = new Intl.NumberFormat('en-US')
const dateTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export type CreditPanelProps = {
  snapshot: CreditSnapshot | null
  status: CreditBalanceState['status']
  refreshing: boolean
  onRefresh?: () => void
}

/** Rich account status uses normal text/actions, not pretend menu items. */
export default function CreditPanel({ snapshot, status, refreshing, onRefresh }: CreditPanelProps) {
  const metered = snapshot?.mode === 'metered' && snapshot.available !== null
  const stale = status === 'error' && snapshot !== null && snapshot.mode !== 'unavailable'
  const unavailable = snapshot?.mode === 'unavailable' || (!snapshot && status === 'error')

  return (
    <section className={styles.creditPanel} aria-label={snapshot?.mode === 'legacy' ? 'Usage limits' : 'Credit balance'}>
      <div className={styles.creditHeading}>
        <h3>{snapshot?.mode === 'legacy' ? 'Account access' : 'Credit balance'}</h3>
        {snapshot ? <span>{snapshot.audience === 'member' ? 'Member access' : 'Guest access'}</span> : null}
      </div>
      <div className={styles.creditReadout} role="status" aria-live="polite" aria-atomic="true">
        {metered ? (
          <><strong>{exactNumber.format(snapshot.available!)}</strong><span>available</span></>
        ) : (
          <strong className={styles.creditMode}>
            {snapshot?.mode === 'legacy' ? 'Usage limits'
              : snapshot?.mode === 'unmetered' ? 'Unmetered'
              : unavailable ? 'Credits unavailable' : 'Loading credits'}
          </strong>
        )}
      </div>
      {metered ? (
        <dl className={styles.creditDetails}>
          {snapshot.reserved !== null && snapshot.reserved > 0 ? (
            <div><dt>Reserved for current work</dt><dd>{exactNumber.format(snapshot.reserved)}</dd></div>
          ) : null}
          {snapshot.allowance !== null ? (
            <div><dt>Credit allowance</dt><dd>{exactNumber.format(snapshot.allowance)}</dd></div>
          ) : null}
          {snapshot.used !== null && snapshot.used > 0 ? (
            <div><dt>Spent in active window</dt><dd>{exactNumber.format(snapshot.used)}</dd></div>
          ) : null}
          {snapshot.next_return_at && snapshot.next_return_amount > 0 ? (
            <div>
              <dt>Next credit return</dt>
              <dd>{exactNumber.format(snapshot.next_return_amount)} at <time dateTime={snapshot.next_return_at}>{dateTime.format(new Date(snapshot.next_return_at))}</time></dd>
            </div>
          ) : null}
          {snapshot.next_expiry_at && (snapshot.next_expiry_amount ?? 0) > 0 ? (
            <div>
              <dt>Temporary credits expire</dt>
              <dd>{exactNumber.format(snapshot.next_expiry_amount!)} at <time dateTime={snapshot.next_expiry_at}>{dateTime.format(new Date(snapshot.next_expiry_at))}</time></dd>
            </div>
          ) : null}
        </dl>
      ) : snapshot?.mode === 'legacy' ? (
        <p className={styles.creditNote}>{snapshot.message || 'Per-tool usage limits apply. Pooled credits are not enabled.'}</p>
      ) : snapshot?.mode === 'unmetered' ? (
        <p className={styles.creditNote}>{snapshot.message || 'No credit cap applies to this account. Tool availability still applies.'}</p>
      ) : unavailable ? (
        <p className={styles.creditNote}>{snapshot?.message || 'Your balance could not be confirmed. Try refreshing.'}</p>
      ) : null}
      {metered && snapshot.reserved !== null && snapshot.reserved > 0 ? (
        <p className={styles.creditNote}>Reserved credits are held for pending work.</p>
      ) : null}
      {metered && snapshot.available === 0 ? <p className={styles.creditNote}>No credits available.</p> : null}
      {metered && snapshot.message ? <p className={styles.creditNote}>{snapshot.message}</p> : null}
      <div className={styles.creditFreshness}>
        <span>
          {refreshing ? 'Updating account status' : stale ? 'Could not update. Last confirmed balance shown.'
            : snapshot ? <>Confirmed <time dateTime={snapshot.as_of}>{dateTime.format(new Date(snapshot.as_of))}</time></>
            : unavailable ? 'Balance not confirmed' : 'Reading account status'}
        </span>
        {onRefresh ? (
          <button type="button" className={styles.creditRefresh} onClick={onRefresh} disabled={refreshing} aria-label="Refresh account balance">
            {refreshing ? 'Updating' : status === 'error' ? 'Retry' : 'Refresh'}
          </button>
        ) : null}
      </div>
    </section>
  )
}
