'use client'

import Link from 'next/link'
import { Inter } from 'next/font/google'
import { useEffect } from 'react'
import './theme.css'
import './home.css'
import styles from './system-state.module.css'

/* The UI face, declared again: global-error replaces the root layout, so the
   layout's next/font variables do not exist here, and theme.css's body stack
   starts with var(--mc-font-ui). */
const inter = Inter({ subsets: ['latin'], variable: '--mc-font-ui' })

/**
 * Last-resort boundary for a failure in the root layout itself (Next.js
 * global-error convention). It replaces the whole document, so it carries its
 * own <html>/<body>, stylesheet and font, and reads the global theme key the
 * same way app/layout.tsx's bootstrap script does — read-only, it never writes
 * the key. Same "sheet fell out of the stack" surface as app/error.tsx.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error('Root layout error', error.digest ?? error.message)
  }, [error])

  useEffect(() => {
    try {
      const saved = localStorage.getItem('smilepdf-theme')
      const theme = saved === 'light' || saved === 'dark'
        ? saved
        : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      document.documentElement.dataset.theme = theme
      document.documentElement.style.colorScheme = theme
    } catch {
      // Storage blocked: theme.css's :root already is the dark theme.
    }
  }, [])

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.variable}>
        <title>Something broke | mycloove</title>
        <main className="home-page">
          <div className={styles.wrap}>
            <div className={styles.stack}>
              <span className={styles.ghostBack} aria-hidden="true" />
              <span className={styles.ghost} aria-hidden="true" />
              <section className={styles.card} role="alert">
                <p className={styles.code}>Something broke</p>
                <h1 className={styles.title}>mycloove could not load this page.</h1>
                <p className={styles.lede}>
                  The problem is on our side, not with your file. Try again; if it keeps happening, start again
                  from the home page.
                </p>
                <div className={styles.actions}>
                  <button type="button" className={styles.primary} onClick={() => unstable_retry()}>
                    Try again
                  </button>
                  {/* A full navigation, not a client transition: the app shell itself failed. */}
                  <Link href="/" prefetch={false} className={styles.ghostBtn} onClick={(event) => { event.preventDefault(); window.location.assign('/') }}>
                    Go to the home page
                  </Link>
                </div>
              </section>
            </div>
          </div>
        </main>
      </body>
    </html>
  )
}
