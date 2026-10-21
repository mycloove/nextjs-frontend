'use client'

import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import SettingsModal, { type SettingsTab } from './SettingsModal'
import styles from './profile.module.css'

/**
 * The account control in the top-right of every surface.
 *
 * Signed in: an avatar chip that opens a small menu (Settings / Admin / Sign
 * out) and the two-column settings modal.
 * Guest: a placeholder avatar that opens the settings modal directly, showing
 * only the categories a guest can configure (Appearance) plus a sign-in action.
 *
 * Styled from the global surface tokens, so it is correct on both the marketing
 * home and the tool topbars without depending on `home.css`.
 */
export default function ProfileMenu({
  email,
  role,
  name = null,
  avatarUrl = null,
  variant = 'desktop',
  onNavigate,
}: {
  email: string | null
  role: string | null
  /** Editable display name; the chip prefers its initial over the email's. */
  name?: string | null
  /** Uploaded profile photo URL; when set the chip shows it instead of a letter. */
  avatarUrl?: string | null
  variant?: 'desktop' | 'mobile'
  onNavigate?: () => void
}) {
  const signedIn = Boolean(email)
  const [menuOpen, setMenuOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [tab, setTab] = useState<SettingsTab>(signedIn ? 'profile' : 'theme')
  const [signingOut, setSigningOut] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const initial = (name?.trim()?.[0] || email?.charAt(0) || '?').toUpperCase()

  useEffect(() => {
    if (!menuOpen || variant === 'mobile') return
    const close = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') setMenuOpen(false)
        return
      }
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('keydown', close)
    document.addEventListener('pointerdown', close)
    return () => {
      document.removeEventListener('keydown', close)
      document.removeEventListener('pointerdown', close)
    }
  }, [menuOpen, variant])

  const openModal = (next: SettingsTab) => {
    setTab(next)
    setMenuOpen(false)
    setModalOpen(true)
  }

  const signOut = async () => {
    setSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    setMenuOpen(false)
    setSigningOut(false)
    onNavigate?.()
  }

  const modal = signedIn
    ? <SettingsModal key={tab} open={modalOpen} onClose={() => setModalOpen(false)} email={email} onSignOut={signOut} initialTab={tab} />
    : <SettingsModal key="guest" open={modalOpen} onClose={() => setModalOpen(false)} email={null} onSignOut={signOut} initialTab={tab} />

  // Guest: the avatar opens the settings modal directly (no dropdown).
  if (!signedIn) {
    return (
      <div className={styles.account}>
        <button
          type="button"
          className={`${styles.chip} ${styles.chipGuest}`}
          onClick={() => { setMenuOpen(false); onNavigate?.(); setModalOpen(true) }}
          aria-label="Account and settings — sign in"
          title="Account and settings"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        </button>
        {modal}
      </div>
    )
  }

  if (variant === 'mobile') {
    return (
      <div className={styles.mobileAccount}>
        <p className={styles.mobileEmail}>{email}</p>
        <button type="button" className={styles.mobileAction} onClick={() => { onNavigate?.(); setModalOpen(true) }}>
          Settings
        </button>
        {role && role !== 'User' ? (
          <Link href="/admin" className={styles.mobileAction} onClick={onNavigate}>
            {role} console
          </Link>
        ) : null}
        <button type="button" className={styles.mobileAction} onClick={signOut} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
        {modal}
      </div>
    )
  }

  return (
    <div className={styles.account} ref={menuRef}>
      <button
        type="button"
        className={styles.chip}
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label="Account menu"
        title={email ?? undefined}
      >
        <span className={styles.avatar} aria-hidden="true">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- owner-scoped avatar; a plain <img> avoids coupling next/image to the storage host
            <img className={styles.avatarImage} src={avatarUrl} alt="" loading="lazy" />
          ) : initial}
        </span>
      </button>

      {menuOpen ? (
        <div className={styles.menu} role="menu">
          <div className={styles.menuIdentity}>
            <span className={styles.menuEmail}>{email}</span>
            {role ? <span className={styles.menuRole}>{role}</span> : null}
          </div>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => openModal('profile')}>
            Settings
          </button>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => openModal('theme')}>
            Appearance
          </button>
          {role && role !== 'User' ? (
            <Link href="/admin" role="menuitem" className={styles.menuItem} onClick={() => { setMenuOpen(false); onNavigate?.() }}>
              {role} console
            </Link>
          ) : null}
          <button type="button" role="menuitem" className={styles.menuItem} onClick={signOut} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : null}

      {modal}
    </div>
  )
}
