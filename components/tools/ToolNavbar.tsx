'use client'

import Link from 'next/link'
import AnimatedBrandLogo from '@/components/animated-brand-logo/AnimatedBrandLogo'
import MyclooveWordmark from '@/components/brand/mycloove/MyclooveWordmark'
import AuthNavButton from '@/components/AuthNavButton'
import { getTool, type ToolId } from '@/lib/tools/registry'
import type { AccountViewerState } from '@/lib/account/useAccountViewer'
import type { CreditBalanceState } from '@/lib/usage/credit-types'
import type { NavigationAvailability } from './toolNavigation'
import ToolSwitcher from './ToolSwitcher'
import styles from './ToolNavigation.module.css'

type Props = {
  toolId: ToolId
  aligned?: boolean
  accountState: AccountViewerState
  creditState: CreditBalanceState
  availability: NavigationAvailability
}

export default function ToolNavbar({ toolId, aligned = false, accountState, creditState, availability }: Props) {
  const tool = getTool(toolId)
  return (
    <header className={`${styles.navbar} ${aligned ? styles.aligned : ''} ${toolId === 'merge-pdf' ? styles.merge : ''}`} data-tool-navbar={toolId}>
      <div className={styles.navbarInner}>
        <div className={styles.identity}>
          <Link href="/" className={styles.brand} aria-label="mycloove home">
            <AnimatedBrandLogo />
            <span className={styles.wordmark}><MyclooveWordmark tone="auto" accent="orange" /></span>
          </Link>
          <span className={styles.rule} aria-hidden="true" />
          <span className={styles.toolName} title={tool.label}>{tool.label}</span>
        </div>
        <div className={styles.controls}>
          <ToolSwitcher toolId={toolId} availability={availability} />
          <AuthNavButton chrome="tool" accountState={accountState} creditState={creditState} creditDisplayToolId={toolId} />
        </div>
      </div>
    </header>
  )
}
