'use client'

import SiteHeader from '@/components/site-header/SiteHeader'
import { getTool, type ToolId } from '@/lib/tools/registry'
import type { AccountViewerState } from '@/lib/account/useAccountViewer'
import type { CreditBalanceState } from '@/lib/usage/credit-types'
import { navigationGroupOf, type NavigationAvailability } from './toolNavigation'
import ToolSwitcher from './ToolSwitcher'
import CreditPill, { creditPillVisible } from './CreditPill'
import styles from './ToolNavigation.module.css'

type Props = {
  toolId: ToolId
  accountState: AccountViewerState
  creditState: CreditBalanceState
  availability: NavigationAvailability
  /** A contract hook the owning page keeps on its bar (e.g. `.spl-sitebar`). */
  className?: string
  /** The tool's content target for the skip link. */
  skipTo?: string | null
}

/*
  Every tool page's bar: the site header in its tool frame, carrying only
  what a tool needs — the breadcrumb [mycloove] › [group] › [tool], the credit
  readout, the tool index (Ctrl/⌘K; none of these tools binds that chord
  itself) and the account. The global marketing index is not shown here: the
  tool index is the way to every other tool.

  The bar is neutral Ink/Paper on every tool, whatever the tool's palette
  (owner direction D8 keeps tool colours on the tool's own surface).
*/
export default function ToolNavbar({ toolId, accountState, creditState, availability, className = '', skipTo = '#main-content' }: Props) {
  const tool = getTool(toolId)
  const group = navigationGroupOf(toolId)
  return (
    <SiteHeader
      frame="tool"
      className={`${styles.chassis}${className ? ` ${className}` : ''}`}
      toolNavbarId={toolId}
      skipTo={skipTo}
      accountState={accountState}
      creditState={creditState}
      context={{ group: group ? group.replace(' And ', ' & ') : null, current: tool.label }}
      extras={(
        <>
          <CreditPill creditState={creditState} toolId={toolId} />
          <ToolSwitcher toolId={toolId} availability={availability} shortcut />
        </>
      )}
      creditDisplayToolId={toolId}
      /* The pill carries the balance on wide screens; the docked badge covers
         only the widths where the pill is hidden. */
      dockedCredit={creditPillVisible(creditState, toolId) ? 'narrow' : 'always'}
    />
  )
}
