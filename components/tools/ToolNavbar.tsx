'use client'

import Link from 'next/link'
import AnimatedBrandLogo from '@/components/animated-brand-logo/AnimatedBrandLogo'
import MyclooveWordmark from '@/components/brand/mycloove/MyclooveWordmark'
import AuthNavButton from '@/components/AuthNavButton'
import { getTool, type ToolId } from '@/lib/tools/registry'
import type { AccountViewerState } from '@/lib/account/useAccountViewer'
import type { CreditBalanceState } from '@/lib/usage/credit-types'
import { navigationGroupOf, type NavigationAvailability } from './toolNavigation'
import ToolSwitcher from './ToolSwitcher'
import CreditPill, { creditPillVisible } from './CreditPill'
import styles from './ToolNavigation.module.css'

type Props = {
  toolId: ToolId
  aligned?: boolean
  accountState: AccountViewerState
  creditState: CreditBalanceState
  availability: NavigationAvailability
}

/* Breadcrumb chassis (roadmap §7.2): [mark + wordmark] / [group] / [tool].
   Ctrl/⌘K opens the tool index here — none of the ToolWorkspace tools binds
   that chord itself. */
export default function ToolNavbar({ toolId, aligned = false, accountState, creditState, availability }: Props) {
  const tool = getTool(toolId)
  const group = navigationGroupOf(toolId)
  return (
    <header className={`${styles.navbar} ${aligned ? styles.aligned : ''} ${toolId === 'merge-pdf' ? styles.merge : ''}`} data-tool-navbar={toolId}>
      <div className={styles.navbarInner}>
        <nav className={styles.identity} aria-label="Breadcrumb">
          <Link href="/" className={styles.brand} aria-label="mycloove home">
            <AnimatedBrandLogo />
            <span className={styles.wordmark}><MyclooveWordmark tone="auto" accent="orange" /></span>
          </Link>
          {group && (
            <>
              <span className={`${styles.rule} ${styles.crumbStep}`} aria-hidden="true" />
              <span className={`${styles.crumbGroup} ${styles.crumbStep}`}>{group.replace(' And ', ' & ')}</span>
            </>
          )}
          <span className={styles.rule} aria-hidden="true" />
          <span className={styles.toolName} title={tool.label} aria-current="page">{tool.label}</span>
        </nav>
        <div className={styles.controls}>
          <CreditPill creditState={creditState} toolId={toolId} />
          <ToolSwitcher toolId={toolId} availability={availability} shortcut />
          <AuthNavButton
            chrome="tool"
            accountState={accountState}
            creditState={creditState}
            creditDisplayToolId={toolId}
            /* The pill carries the balance on wide screens; the docked badge
               covers only the widths where the pill is hidden. */
            dockedCredit={creditPillVisible(creditState, toolId) ? 'narrow' : 'always'}
          />
        </div>
      </div>
    </header>
  )
}
