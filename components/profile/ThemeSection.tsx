'use client'

import { useEffect, useState } from 'react'
import styles from './profile.module.css'

type ThemeChoice = 'dark' | 'light' | 'system'

/**
 * The global theme key (CLAUDE.md §8 trap 6). This is surface 1's key, applied
 * to `<html data-theme>` and read by `app/layout.tsx`'s bootstrap script and
 * `ThemeToggle`. The Image Editor and Document AI keep their own separate keys
 * on purpose — this control only ever drives the global chrome.
 */
const STORAGE_KEY = 'smilepdf-theme'

function readStored(): ThemeChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark' || saved === 'light' || saved === 'system') return saved
  } catch {
    // localStorage can throw in private mode; fall through to System.
  }
  return 'system'
}

function resolve(choice: ThemeChoice): 'dark' | 'light' {
  if (choice === 'dark' || choice === 'light') return choice
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function apply(choice: ThemeChoice) {
  const resolved = resolve(choice)
  document.documentElement.setAttribute('data-theme', resolved)
  document.documentElement.style.colorScheme = resolved
}

const OPTIONS: { id: ThemeChoice; title: string; hint: string; preview: string; icon: React.ReactNode }[] = [
  {
    id: 'dark',
    title: 'Dark',
    hint: 'Dim, low-glare surfaces.',
    preview: 'themePreviewDark',
    icon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />,
  },
  {
    id: 'light',
    title: 'Light',
    hint: 'Bright, high-contrast surfaces.',
    preview: 'themePreviewLight',
    icon: (
      <>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" />
      </>
    ),
  },
  {
    id: 'system',
    title: 'System',
    hint: 'Match your device setting.',
    preview: 'themePreviewSystem',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="12.5" rx="2" />
        <path d="M9 20.5h6M12 16.5v4" />
      </>
    ),
  },
]

/**
 * Appearance control for the global theme: Dark / Light / System, shown as
 * preview tiles that depict the surface each option produces rather than a bare
 * swatch. System mode tracks `prefers-color-scheme` live, so changing the OS
 * appearance updates the app without a reload. Only rendered inside the settings
 * modal, so it always runs on the client and can read the stored choice
 * synchronously.
 */
export default function ThemeSection() {
  const [choice, setChoice] = useState<ThemeChoice>(() => readStored())

  useEffect(() => {
    apply(choice)
    if (choice !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [choice])

  const choose = (next: ThemeChoice) => {
    setChoice(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* Applied for this session regardless. */ }
    apply(next)
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Appearance</h3>
        <p className={styles.sectionHint}>Choose how mycloove looks across the whole app.</p>
      </div>

      <div className={styles.themeGrid} role="radiogroup" aria-label="Theme">
        {OPTIONS.map((option) => {
          const active = choice === option.id
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`${styles.themeTile} ${active ? styles.themeTileActive : ''}`}
              onClick={() => choose(option.id)}
            >
              {/* Preview colours are fixed, not tokens: each tile must depict the
                  theme it selects, which by definition is not the active one. */}
              <span className={`${styles.themePreview} ${styles[option.preview]}`} aria-hidden="true">
                <span className={styles.themePreviewIcon}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    {option.icon}
                  </svg>
                </span>
                {active ? (
                  <span className={styles.themeCheck}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                ) : null}
              </span>
              <span className={styles.themeTileLabel}>{option.title}</span>
              <span className={styles.themeTileHint}>{option.hint}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
