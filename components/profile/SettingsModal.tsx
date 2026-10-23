'use client'

import Link from 'next/link'
import type { CreditBalanceState } from '@/lib/usage/credit-types'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ActivitySection from './ActivitySection'
import AvatarSection from './AvatarSection'
import ChangePasswordSection from './ChangePasswordSection'
import CreditBadge from './CreditBadge'
import ProfileInfoSection from './ProfileInfoSection'
import ThemeSection from './ThemeSection'
import { fetchProfile, type Profile } from './profileApi'
import styles from './profile.module.css'

export type SettingsTab = 'profile' | 'avatar' | 'password' | 'activity' | 'theme'

const ICONS: Record<SettingsTab, React.ReactNode> = {
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  avatar: <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="12" cy="10" r="3.2" /><path d="M6.5 18.5a5.5 5.5 0 0 1 11 0" /></>,
  password: <><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  activity: <><path d="M4 19V5M4 15l5-5 4 3 7-7" /></>,
  theme: <><path d="M12 3a9 9 0 1 0 9 9c-4.97 0-9-4.03-9-9Z" /></>,
}

const LABELS: Record<SettingsTab, string> = {
  profile: 'Profile',
  avatar: 'Avatar',
  password: 'Password',
  activity: 'Activity',
  theme: 'Appearance',
}

/**
 * Settings as a floating, two-column modal: a persistent navigation column on
 * the left (identity, category list, sign in/out) and a dynamic configuration
 * area on the right that swaps the section for the selected category.
 *
 * Signed-in accounts get Profile, Password, Activity and Appearance. Guests get
 * Appearance only, plus a sign-in action — the categories their account can
 * actually configure. The modal is self-contained on the global surface tokens,
 * so it reads correctly on every route in both themes.
 *
 * Accessibility is floor: focus is trapped and moved in on open, Escape closes,
 * the trigger regains focus on close, the body is scroll-locked, and every
 * transition collapses under `prefers-reduced-motion`.
 */
export default function SettingsModal({
  open,
  onClose,
  email,
  accountId = null,
  accountActive = null,
  name = null,
  avatarUrl = null,
  creditState,
  showCredits = true,
  onSignOut,
  signingOut = false,
  signOutError = '',
  onProfileChange,
  onRestoreFocus,
  initialTab,
}: {
  open: boolean
  onClose: () => void
  email: string | null
  accountId?: string | null
  accountActive?: boolean | null
  name?: string | null
  avatarUrl?: string | null
  creditState?: CreditBalanceState
  showCredits?: boolean
  onSignOut: () => void
  signingOut?: boolean
  signOutError?: string
  onProfileChange?: () => void
  onRestoreFocus?: () => void
  initialTab?: SettingsTab
}) {
  const signedIn = Boolean(accountId || email)
  const tabs: SettingsTab[] = signedIn ? ['profile', 'avatar', 'password', 'activity', 'theme'] : ['theme']

  const [tab, setTab] = useState<SettingsTab>(
    initialTab && tabs.includes(initialTab) ? initialTab : signedIn ? 'profile' : 'theme',
  )
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState('')
  const modalRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const id = useId()
  // A response from another auth epoch is never shown, even before a new read
  // completes. ProfileMenu also keys the modal by the verified account ID.
  const currentProfile = profile && (accountId ? profile.id === accountId : profile.email === email) ? profile : null

  // Derive the active tab rather than resetting state in an effect: if the auth
  // state changes while open, the active tab simply falls back to the first
  // category the account can configure.
  const activeTab: SettingsTab = tabs.includes(tab) ? tab : tabs[0]

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    let alive = true
    // State is only written from callbacks, never synchronously in the effect
    // body (React's set-state-in-effect rule).
    if (signedIn) {
      fetchProfile()
        .then((value) => {
          if (alive) {
            const matchesActor = value && (accountId ? value.id === accountId : value.email === email)
            setProfile(matchesActor ? value : null)
            setError(matchesActor ? '' : 'Could not confirm your profile. Try opening settings again.')
          }
        })
        .catch(() => { if (alive) setError('Could not load your profile.') })
    }
    const focusTimer = window.setTimeout(() => {
      if (!modalRef.current?.contains(document.activeElement)) {
        const first = modalRef.current?.querySelector<HTMLElement>('[data-autofocus]')
        ;(first ?? modalRef.current)?.focus()
      }
    }, 0)
    return () => {
      alive = false
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      if (onRestoreFocus) onRestoreFocus()
      else restoreRef.current?.focus?.()
    }
  }, [open, signedIn, accountId, email, onRestoreFocus])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusables = modalRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables?.length) return
      const list = Array.from(focusables)
      const first = list[0]
      const last = list[list.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === modalRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === modalRef.current)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  const displayName = signedIn ? currentProfile?.name?.trim() || name?.trim() || email?.split('@')[0] || 'Your account' : 'Guest'
  const photoUrl = currentProfile ? currentProfile.avatar_url : avatarUrl
  const profileChanged = (value: Profile) => {
    if (accountId ? value.id !== accountId : value.email !== email) return
    setProfile(value)
    onProfileChange?.()
  }

  // Portalled to <body>: the tool and home topbars set `backdrop-filter`, which
  // makes them the containing block for a `position: fixed` descendant — the
  // modal would otherwise be trapped inside the 62px bar. The portal keeps the
  // overlay relative to the viewport on every surface.
  return createPortal(
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-account-surface
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <nav className={styles.modalNav} aria-label="Settings categories">
          <div className={styles.navIdentity}>
            {signedIn ? (
              photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- owner-scoped avatar; a plain <img> avoids coupling next/image to the storage host
                <img className={`${styles.navAvatar} ${styles.navAvatarPhoto}`} src={photoUrl} alt="" />
              ) : (
                <span className={styles.navAvatar} aria-hidden="true">{(displayName[0] ?? '?').toUpperCase()}</span>
              )
            ) : (
              <span className={`${styles.navAvatar} ${styles.navAvatarGuest}`} aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21a8 8 0 0 1 16 0" />
                </svg>
              </span>
            )}
            <span className={styles.navIdText}>
              <span className={styles.navName}>{displayName}</span>
              <span className={styles.navEmail}>{email || (signedIn ? 'Signed in' : 'Not signed in')}</span>
              {signedIn && accountActive === false ? <span className={styles.navEmail}>Inactive account</span> : null}
            </span>
            {showCredits ? <div className={styles.settingsCredit}>
              <CreditBadge snapshot={creditState?.snapshot ?? null} status={creditState?.status ?? 'loading'} refreshing={creditState?.refreshing ?? false} variant="pill" />
              {creditState?.status === 'error' && creditState.snapshot ? <span className={styles.settingsCreditStatus}>Last confirmed</span>
                : creditState?.refreshing ? <span className={styles.settingsCreditStatus}>Updating</span> : null}
            </div> : null}
          </div>

          <div className={styles.navList} role="tablist" aria-label="Settings categories" aria-orientation="vertical">
            {tabs.map((entry) => (
              <button
                key={entry}
                type="button"
                role="tab"
                id={`${id}-tab-${entry}`}
                aria-selected={activeTab === entry}
                aria-controls={`${id}-pane`}
                className={`${styles.navItem} ${activeTab === entry ? styles.navItemActive : ''}`}
                onClick={() => setTab(entry)}
              >
                <svg className={styles.navItemIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {ICONS[entry]}
                </svg>
                {LABELS[entry]}
              </button>
            ))}
          </div>

          <div className={styles.navFooter}>
            {signedIn ? (
              <button type="button" className={styles.navAction} onClick={onSignOut} disabled={signingOut}>
                {signingOut ? 'Signing out...' : 'Sign out'}
              </button>
            ) : (
              <Link href="/login" className={styles.navActionPrimary} onClick={onClose}>
                Sign in
              </Link>
            )}
            {signOutError ? <p className={styles.accountError} role="alert">{signOutError}</p> : null}
          </div>
        </nav>

        <div className={`${styles.modalBody} ${activeTab === 'activity' ? styles.modalBodyFixed : ''}`}>
          <button className={styles.closeBtn} type="button" onClick={onClose} aria-label="Close settings" data-autofocus>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>

          <div className={`${styles.modalPane} ${activeTab === 'activity' ? styles.modalPaneFixed : ''}`} role="tabpanel" id={`${id}-pane`} aria-labelledby={`${id}-tab-${activeTab}`}>
            {activeTab === 'theme' ? (
              <ThemeSection />
            ) : activeTab === 'activity' ? (
              <ActivitySection />
            ) : !currentProfile && error ? (
              <p className={styles.error} role="alert">{error}</p>
            ) : !currentProfile ? (
              <p className={styles.muted} role="status">Loading…</p>
            ) : activeTab === 'avatar' ? (
              <AvatarSection profile={currentProfile} onProfileChange={profileChanged} />
            ) : activeTab === 'profile' ? (
              <ProfileInfoSection profile={currentProfile} onProfileChange={profileChanged} initialFocus />
            ) : (
              <ChangePasswordSection email={currentProfile.email} />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
