'use client'

import { createClient } from '@/lib/supabase/client'
import type { CreditBalanceState } from '@/lib/usage/credit-types'
import Link from 'next/link'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import CreditBadge, { creditBalanceLabel } from './CreditBadge'
import CreditPanel from './CreditPanel'
import SettingsModal, { type SettingsTab } from './SettingsModal'
import styles from './profile.module.css'

/**
 * Account Seal: identity and confirmed capacity in one quiet readout. Guests
 * and members open the same nonmodal account dialog; settings stay a separate
 * modal. This shared surface uses global tokens, never a tool's internal skin.
 */
export default function ProfileMenu({
  email,
  role,
  accountId = null,
  accountActive = null,
  name = null,
  avatarUrl = null,
  creditState,
  creditDisplayToolId,
  variant = 'desktop',
  onNavigate,
  onRefreshAccount,
  onSignOut,
}: {
  email: string | null
  role: string | null
  accountId?: string | null
  accountActive?: boolean | null
  /** Editable display name; the chip prefers its initial over the email's. */
  name?: string | null
  /** Uploaded profile photo URL; when set the chip shows it instead of a letter. */
  avatarUrl?: string | null
  creditState?: CreditBalanceState
  creditDisplayToolId?: string
  variant?: 'desktop' | 'mobile'
  onNavigate?: () => void
  onRefreshAccount?: () => void
  onSignOut?: () => Promise<void>
}) {
  // accountId is authoritative; email remains a fallback for existing callers.
  const signedIn = Boolean(accountId || email)
  const [menuOpen, setMenuOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [tab, setTab] = useState<SettingsTab>(signedIn ? 'profile' : 'theme')
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const accountRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const dialogId = useId()

  const initial = (name?.trim()?.[0] || email?.charAt(0) || '?').toUpperCase()
  const displayName = signedIn ? name?.trim() || email?.split('@')[0] || 'Your account' : 'Guest'
  const snapshot = creditState?.snapshot ?? null
  const status = creditState?.status ?? 'loading'
  const refreshing = creditState?.refreshing ?? false
  const balanceLabel = creditBalanceLabel(snapshot, status, refreshing)
  const showCredits = !creditDisplayToolId || Boolean(snapshot && status !== 'loading' && snapshot.prices[creditDisplayToolId]?.enabled !== false)
  const visibleCreditState = showCredits ? creditState : undefined
  const restoreFocus = useCallback(() => triggerRef.current?.focus({ preventScroll: true }), [])

  useEffect(() => {
    if (!menuOpen) return
    const trigger = triggerRef.current
    const panel = menuRef.current
    if (!trigger || !panel) return

    const position = () => {
      const viewport = window.visualViewport
      const leftEdge = (viewport?.offsetLeft ?? 0) + 12
      const topEdge = (viewport?.offsetTop ?? 0) + 12
      const width = viewport?.width ?? window.innerWidth
      const height = viewport?.height ?? window.innerHeight
      const bounds = trigger.getBoundingClientRect()
      if (!trigger.getClientRects().length) {
        setMenuOpen(false)
        return
      }
      panel.style.width = `${Math.min(320, Math.max(0, width - 24))}px`
      panel.style.maxHeight = `${Math.max(0, height - 24)}px`
      const panelHeight = panel.offsetHeight
      const below = bounds.bottom + 8
      const above = bounds.top - panelHeight - 8
      const bottomEdge = topEdge + height - 24
      const flipped = below + panelHeight > bottomEdge && above >= topEdge
      const top = Math.max(topEdge, Math.min(flipped ? above : below, bottomEdge - panelHeight))
      const left = Math.max(leftEdge, Math.min(bounds.right - panel.offsetWidth, leftEdge + width - 24 - panel.offsetWidth))
      panel.style.left = `${left}px`
      panel.style.top = `${top}px`
      panel.style.visibility = 'visible'
      panel.dataset.placement = flipped ? 'above' : 'below'
    }
    const inside = (target: EventTarget | null) => target instanceof Node &&
      (accountRef.current?.contains(target) || panel.contains(target))
    const outside = (event: PointerEvent | FocusEvent) => {
      if (inside(event.target)) return
      const wasFocused = panel.contains(document.activeElement)
      setMenuOpen(false)
      if (wasFocused && event instanceof PointerEvent) {
        // Keep a clicked control's new focus. Clicking inert page material
        // instead returns focus to the account trigger, never a removed dialog.
        requestAnimationFrame(() => {
          if (document.activeElement === document.body || document.activeElement === panel) restoreFocus()
        })
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      // Escape dismisses this layer, not the navigation underneath it.
      event.stopImmediatePropagation()
      setMenuOpen(false)
      restoreFocus()
    }
    position()
    panel.focus({ preventScroll: true })
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(position) : null
    observer?.observe(panel)
    observer?.observe(trigger)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
    return () => {
      observer?.disconnect()
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside)
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      window.visualViewport?.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('scroll', position)
    }
  }, [menuOpen, restoreFocus])

  const openModal = (next: SettingsTab) => {
    setTab(next)
    setMenuOpen(false)
    creditState?.refresh()
    setModalOpen(true)
  }

  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    setSignOutError('')
    try {
      if (onSignOut) await onSignOut()
      else {
        // Clear the custom account session first, then any Supabase session
        // (legacy/Google). Each call is a no-op when its system has no session.
        const cleared = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
        if (!cleared.ok) throw new Error('logout-failed')
        const { error } = await createClient().auth.signOut()
        if (error) throw error
      }
      setMenuOpen(false)
      setModalOpen(false)
      onNavigate?.()
      restoreFocus()
    } catch {
      setSignOutError('Could not sign out. Try again.')
    } finally {
      setSigningOut(false)
    }
  }

  const navigate = () => {
    setMenuOpen(false)
    onNavigate?.()
  }

  const avatar = (
    <span className={styles.accountAvatar} aria-hidden="true">
      {signedIn && avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- owner-scoped photo; no storage-host coupling to next/image
        <img className={styles.avatarImage} src={avatarUrl} alt="" loading="lazy" />
      ) : signedIn ? initial : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      )}
    </span>
  )

  return (
    <div className={`${styles.account} ${variant === 'mobile' ? styles.accountMobile : ''}`} ref={accountRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.chip} ${variant === 'mobile' ? styles.chipMobile : ''}`}
        onClick={() => {
          if (!menuOpen) creditState?.refresh()
          setMenuOpen((open) => !open)
        }}
        aria-expanded={menuOpen}
        aria-controls={dialogId}
        aria-haspopup="dialog"
        aria-label={showCredits ? `${displayName} account; ${balanceLabel}` : `${displayName} account`}
        title={showCredits ? `${displayName}: ${balanceLabel}` : displayName}
      >
        <span className={styles.avatarDock} aria-hidden="true">
          {avatar}
          {showCredits ? <CreditBadge snapshot={snapshot} status={status} refreshing={refreshing} /> : null}
        </span>
        {variant === 'mobile' ? (
          <span className={styles.chipIdentity}><strong>{displayName}</strong><span>{email || (signedIn ? 'Signed in' : 'Not signed in')}</span></span>
        ) : null}
      </button>

      {menuOpen && typeof document !== 'undefined' ? createPortal(
        <div ref={menuRef} id={dialogId} className={styles.menu} role="dialog" aria-labelledby={`${dialogId}-title`} tabIndex={-1} data-account-surface>
          <div className={styles.menuIdentity}>
            {avatar}
            <div className={styles.menuIdText}>
              <h2 id={`${dialogId}-title`} className={styles.menuName}>{displayName}</h2>
              <span className={styles.menuSecondary}>{email || (signedIn ? 'Signed in' : 'Not signed in')}</span>
              {signedIn && role ? <span className={styles.menuSecondary}>{role}{accountActive === false ? ' (inactive)' : ''}</span> : null}
            </div>
            <button type="button" className={styles.menuClose} onClick={() => { setMenuOpen(false); restoreFocus() }} aria-label="Close account panel">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
            {showCredits ? <div className={styles.identityCredit}><CreditBadge snapshot={snapshot} status={status} refreshing={refreshing} variant="pill" /></div> : null}
          </div>
          {showCredits ? <CreditPanel snapshot={snapshot} status={status} refreshing={refreshing} onRefresh={creditState?.refresh} /> : null}
          <div className={styles.menuActions}>
            {signedIn ? (
              <>
                <button type="button" className={styles.menuItem} onClick={() => openModal('profile')}>Settings</button>
                <button type="button" className={styles.menuItem} onClick={() => openModal('activity')}>Activity</button>
              </>
            ) : (
              <>
                <Link href="/login" className={styles.menuItem} onClick={navigate}>Sign in</Link>
                <Link href="/register" className={styles.menuItem} onClick={navigate}>Create account</Link>
              </>
            )}
            <button type="button" className={styles.menuItem} onClick={() => openModal('theme')}>Appearance</button>
            {signedIn && role && role !== 'User' ? <Link href="/admin" className={styles.menuItem} onClick={navigate}>{role} console</Link> : null}
            {signedIn ? <button type="button" className={styles.menuItem} onClick={signOut} disabled={signingOut}>{signingOut ? 'Signing out...' : 'Sign out'}</button> : null}
            {signOutError ? <p className={styles.accountError} role="alert">{signOutError}</p> : null}
          </div>
        </div>,
        document.body,
      ) : null}

      <SettingsModal
        key={`${accountId ?? email ?? 'guest'}:${tab}`}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        email={email}
        accountId={accountId}
        accountActive={accountActive}
        name={name}
        avatarUrl={avatarUrl}
        creditState={visibleCreditState}
        showCredits={showCredits}
        onProfileChange={onRefreshAccount}
        onRestoreFocus={restoreFocus}
        onSignOut={signOut}
        signingOut={signingOut}
        signOutError={signOutError}
        initialTab={tab}
      />
    </div>
  )
}
