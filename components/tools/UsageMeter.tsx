'use client'

import Link from 'next/link'
import { useUsageSnapshot } from '@/lib/usage/useUsageSnapshot'
import styles from './ToolWorkspace.module.css'

export default function UsageMeter({ toolId }: { toolId?: string }) {
  const { snapshot } = useUsageSnapshot(toolId)
  if (!snapshot) return null
  /* Admins bypass the quota entirely (admin_bypass is unmetered), so a
     remaining-count would be a lie. The "Admin / not metered" chip that used
     to say so here was retired as topbar clutter — render nothing rather than
     an empty box. The meter below is unchanged for regular users. */
  if (snapshot.is_admin && toolId) return null
  if (!toolId || snapshot.limit <= 0 && !snapshot.tool_label) return null

  const remaining = snapshot.remaining
  const exhausted = remaining <= 0
  const windowLabel = snapshot.period === 'week' ? 'this week' : 'today'

  return (
    <div className={styles.usageMeter} title={`${snapshot.used} of ${snapshot.limit} ${snapshot.tool_label ?? 'calls'} used ${windowLabel}`}>
      <b className={exhausted ? styles.usageZero : undefined}>{remaining}</b>
      <span>
        left {windowLabel}
        <small>{snapshot.tool_label ?? 'this tool'}</small>
      </span>
      {exhausted && !snapshot.authenticated ? (
        <Link href="/login">Sign in</Link>
      ) : null}
    </div>
  )
}
