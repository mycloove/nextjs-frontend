'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import '../home.css'
import styles from '../system-state.module.css'

/**
 * Error boundary for every converter tool route. Same "sheet fell out of the
 * stack" surface as the root app/error.tsx, so a broken tool reads as part of
 * the product rather than an unstyled default (this file used to render a
 * bare inline-styled box).
 *
 * The copy is deliberately honest about state: `reset` re-renders the tool,
 * which clears anything held in the browser, so the user is told they may
 * need to add the file again.
 */
export default function ToolsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // The digest is for support; the message may name internals, so it is not shown.
    console.error('Tool error', error.digest ?? error.message)
  }, [error])

  return (
    <div className="home-page">
      <div className={styles.wrap}>
        <div className={styles.stack}>
          <span className={styles.ghostBack} aria-hidden="true" />
          <span className={styles.ghost} aria-hidden="true" />
          <section className={styles.card} role="alert">
            <p className={styles.code}>Tool error</p>
            <h1 className={styles.title}>This tool stopped on our side.</h1>
            <p className={styles.lede}>
              Every other tool still works. Trying again reloads only this tool, so you may need to add your
              file again.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={reset}>
                Try again
              </button>
              <Link href="/#tools" className={styles.ghostBtn}>
                Browse other tools
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
