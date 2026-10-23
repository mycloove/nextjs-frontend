import type { CreditBalanceState, CreditSnapshot } from '@/lib/usage/credit-types'
import styles from './profile.module.css'

const exactNumber = new Intl.NumberFormat('en-US')
const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export type CreditBadgeProps = {
  snapshot: CreditSnapshot | null
  status?: CreditBalanceState['status']
  refreshing?: boolean
  variant?: 'docked' | 'pill'
}

export function creditBalanceLabel(
  snapshot: CreditSnapshot | null,
  status: CreditBalanceState['status'] = snapshot ? 'ready' : 'loading',
  refreshing = false,
): string {
  if (!snapshot) return status === 'error' ? 'Credits unavailable' : 'Loading credits'
  const label = snapshot.mode === 'legacy' ? 'Usage limits'
    : snapshot.mode === 'unmetered' ? 'Unmetered access'
    : snapshot.mode === 'metered' && snapshot.available !== null ? `${exactNumber.format(snapshot.available)} credits available`
    : 'Credits unavailable'
  return status === 'error' && snapshot.mode !== 'unavailable' ? `${label}; last confirmed, could not update`
    : refreshing ? `${label}; updating` : label
}

/** A readout, never a second click target or an optimistic wallet calculation. */
export default function CreditBadge({
  snapshot,
  status = snapshot ? 'ready' : 'loading',
  refreshing = false,
  variant = 'docked',
}: CreditBadgeProps) {
  const metered = snapshot?.mode === 'metered' && snapshot.available !== null
  const value = metered ? (variant === 'docked' ? compactNumber : exactNumber).format(snapshot.available!)
    : snapshot?.mode === 'unmetered' ? (variant === 'docked' ? 'U' : 'Unmetered')
    : snapshot?.mode === 'legacy' ? (variant === 'docked' ? '-' : 'Usage limits')
    : !snapshot && status === 'loading' ? (variant === 'docked' ? '...' : 'Loading credits')
    : variant === 'docked' ? '-' : 'Credits unavailable'
  const label = creditBalanceLabel(snapshot, status, refreshing)

  return (
    <span
      className={`${styles.creditBadge} ${variant === 'docked' ? styles.creditBadgeDocked : styles.creditBadgePill}`}
      title={label}
      aria-label={label}
      data-state={status === 'error' ? 'stale' : refreshing ? 'updating' : snapshot?.mode ?? 'loading'}
    >
      <span>{value}</span>
      {variant === 'pill' && metered ? <span className={styles.creditBadgeUnit}>Credits</span> : null}
    </span>
  )
}
