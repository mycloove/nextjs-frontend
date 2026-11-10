'use client'

import type { CreditBalanceState } from '@/lib/usage/credit-types'
import styles from './ToolNavigation.module.css'

const number = new Intl.NumberFormat('en-US')
const time = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })

/* At or past 80% of the allowance used, the pill warns — in words, not only colour. */
export const LOW_CREDIT_SHARE = 0.2

/** True when the pill has a real, metered balance to show for this tool. */
export function creditPillVisible(creditState: CreditBalanceState, toolId: string): boolean {
  const snapshot = creditState.snapshot
  if (!snapshot || snapshot.mode !== 'metered') return false
  if (snapshot.available === null || snapshot.allowance === null || snapshot.allowance <= 0) return false
  return snapshot.prices[toolId]?.enabled !== false
}

/**
 * Credit pill for the tool navbar (roadmap §7.3): what is left of the real
 * allowance, as "available / allowance". A readout like profile/CreditBadge,
 * never a second click target and never an optimistic calculation — it shows
 * only what the balance snapshot reports, and nothing at all when the balance
 * is not metered, not known, or this tool does not spend credits.
 *
 * Hidden on narrow screens, where the account button's docked badge already
 * carries the same number.
 */
export default function CreditPill({ creditState, toolId }: { creditState: CreditBalanceState; toolId: string }) {
  const { snapshot, status } = creditState
  if (!snapshot || !creditPillVisible(creditState, toolId)) return null
  // creditPillVisible guarantees both are numbers.
  const available = snapshot.available as number
  const allowance = snapshot.allowance as number

  const low = available <= allowance * LOW_CREDIT_SHARE
  const stale = status === 'error'
  const value = `${number.format(available)} / ${number.format(allowance)}`
  const label = `${number.format(available)} of ${number.format(allowance)} credits left${low ? '; running low' : ''}${stale ? '; last confirmed, could not update' : ''}`
  const returns = snapshot.next_return_at && snapshot.next_return_amount > 0
    ? `${number.format(snapshot.next_return_amount)} credits return ${time.format(new Date(snapshot.next_return_at))}`
    : null

  return (
    <span
      className={styles.creditPill}
      data-low={low}
      data-stale={stale}
      title={returns ? `${label}. ${returns}.` : label}
    >
      {/* Screen readers get the sentence; sighted users get the compact fraction. */}
      <span className={styles.srOnly}>{label}</span>
      <span aria-hidden="true" className={styles.creditPillFace}>
        {low && <span className={styles.creditPillWord}>Low</span>}
        <span className={styles.creditPillValue}>{value}</span>
        <span className={styles.creditPillUnit}>credits</span>
      </span>
    </span>
  )
}
