'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import type { SettingsSectionId } from './settings/settingsContext'
import type { AccountViewer } from '@/lib/account/useAccountViewer'
import type { CreditBalanceState } from '@/lib/usage/credit-types'
import CreditBadge, { creditBalanceLabel } from '@/components/profile/CreditBadge'
import CreditPanel from '@/components/profile/CreditPanel'

/**
 * Mr. Markdown's account control for the workspace topbar.
 *
 * Instrument concept (surface 4, "the master workbench"): the operator's
 * identity seal on the bench. It replaces the previously hardcoded "JS" chip
 * with the real signed-in user — avatar photo when they have one, otherwise the
 * initial of their display name (falling back to their email) — and is the entry
 * point to the calibration console.
 *
 * Identity and credits are resolved once by the MR surface and passed in, so this
 * seal and the console read the *same* `useAccountViewer` instance: a name or
 * avatar change in a console pane lands here without a reload. This control owns
 * only the trigger and its small menu — the console itself is rendered by
 * `Workspace` (in-tree, so it keeps the workspace palette).
 *
 * Guests and members open the same small, non-modal account dialog. It stays
 * in-tree to preserve the native palette, with viewport-clamped placement.
 */
export default function MrMarkdownAccountMenu({
  status,
  viewer,
  signOut,
  onOpenSettings,
  creditState,
}: {
  status: 'loading' | 'ready'
  viewer: AccountViewer | null
  signOut: () => Promise<void>
  onOpenSettings: (section: SettingsSectionId) => void
  creditState: CreditBalanceState
}) {
  const signedIn = Boolean(viewer)
  const [menuOpen, setMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const { snapshot, status: creditStatus, refreshing, refresh } = creditState
  const showCredits = Boolean(snapshot && snapshot.prices['pdf-to-markdown']?.enabled !== false && creditStatus !== 'loading')
  const balanceLabel = creditBalanceLabel(snapshot, creditStatus, refreshing)

  useEffect(() => {
    if (!menuOpen) return
    refresh()
    const placePanel = () => {
      const anchor = wrapRef.current?.getBoundingClientRect()
      const panel = panelRef.current
      if (!anchor || !panel) return
      const viewport = window.visualViewport
      const leftEdge = viewport?.offsetLeft ?? 0
      const topEdge = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth
      const height = viewport?.height ?? window.innerHeight
      const panelWidth = Math.min(320, Math.max(0, width - 24))
      panel.style.width = `${panelWidth}px`
      const panelHeight = Math.min(panel.scrollHeight + 2, Math.max(0, height - 24))
      const below = topEdge + height - anchor.bottom - 20
      const above = anchor.top - topEdge - 20
      const openAbove = below < Math.min(panelHeight, 240) && above > below
      const maxHeight = Math.max(0, Math.min(panelHeight, openAbove ? above : below))
      const left = Math.max(leftEdge + 12, Math.min(anchor.right - panelWidth, leftEdge + width - panelWidth - 12))
      const top = openAbove ? anchor.top - maxHeight - 8 : anchor.bottom + 8
      panel.style.left = `${left - anchor.left}px`
      panel.style.top = `${Math.max(topEdge + 12, Math.min(top, topEdge + height - maxHeight - 12)) - anchor.top}px`
      panel.style.maxHeight = `${maxHeight}px`
      panel.style.transformOrigin = openAbove ? 'bottom right' : 'top right'
    }
    const frame = requestAnimationFrame(() => {
      placePanel()
      panelRef.current?.focus({ preventScroll: true })
    })
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Consume Escape before the workspace's focus-mode exit shortcut.
      event.preventDefault()
      event.stopPropagation()
      setMenuOpen(false)
      triggerRef.current?.focus({ preventScroll: true })
    }
    const observer = new ResizeObserver(placePanel)
    if (panelRef.current) observer.observe(panelRef.current)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', placePanel)
    window.addEventListener('scroll', placePanel, true)
    window.visualViewport?.addEventListener('resize', placePanel)
    window.visualViewport?.addEventListener('scroll', placePanel)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', placePanel)
      window.removeEventListener('scroll', placePanel, true)
      window.visualViewport?.removeEventListener('resize', placePanel)
      window.visualViewport?.removeEventListener('scroll', placePanel)
    }
  }, [menuOpen, refresh])

  const openConsole = (section: SettingsSectionId) => {
    setMenuOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
    onOpenSettings(section)
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    setSignOutError(null)
    try {
      await signOut()
      setMenuOpen(false)
    } catch {
      setSignOutError('Sign out failed. Try again.')
    } finally {
      setSigningOut(false)
    }
  }

  // While the session resolves, keep the seal's footprint with a quiet
  // placeholder so the topbar row never reflows (no "JS" flash).
  if (status === 'loading') {
    return (
      <span className="mr-account-wrap" role="status" aria-label="Loading account">
        <span className="mr-avatar mr-account-trigger mr-avatar-pending" aria-hidden="true"><span className="mr-account-avatar" /></span>
      </span>
    )
  }

  return (
    <div className="mr-account-wrap" ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className="mr-avatar mr-account-trigger"
        onClick={() => setMenuOpen((open) => !open)}
        aria-label={showCredits ? `Account and settings. ${balanceLabel}` : 'Account and settings'}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        // Suppress the hover tooltip while the menu is open so it never overlaps it.
        // The `data-tooltip` rule is the single visible label; a native `title`
        // here would render the browser's own tooltip on top of it (two labels).
        data-tooltip={menuOpen || !showCredits ? undefined : balanceLabel}
      >
        <span className="mr-account-avatar">
          {signedIn && viewer?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- small owner-scoped avatar; a plain <img> avoids coupling next/image to the storage host
            <img className="mr-avatar-img" src={viewer.avatarUrl} alt="" loading="lazy" />
          ) : signedIn && viewer ? (
            initialOf(viewer)
          ) : (
            <GuestGlyph />
          )}
        </span>
        {showCredits ? <CreditBadge snapshot={snapshot} status={creditStatus} refreshing={refreshing} variant="docked" /> : null}
      </button>

      {menuOpen ? (
        <div id={menuId} ref={panelRef} className="mr-account-menu" role="dialog" aria-modal="false" aria-label="Account and credits" tabIndex={-1}>
          <div className="mr-account-identity">
            <div className="mr-account-identity-row">
              <div className="mr-account-identity-copy">
                <span className="mr-account-name">{signedIn ? viewer?.name?.trim() || viewer?.email?.split('@')[0] || 'Account' : 'Guest'}</span>
                <span className="mr-account-email">{signedIn ? viewer?.email : 'Not signed in'}</span>
              </div>
              {showCredits ? <CreditBadge snapshot={snapshot} status={creditStatus} refreshing={refreshing} variant="pill" /> : null}
            </div>
            {viewer?.role ? <span className="mr-account-role">{viewer.role}</span> : null}
          </div>

          {showCredits ? <div className="mr-account-credit-panel">
            <CreditPanel snapshot={snapshot} status={creditStatus} refreshing={refreshing} onRefresh={refresh} />
          </div> : null}

          {signedIn ? (
            <>
              <button type="button" className="mr-account-item" onClick={() => openConsole('identity')}>
                <span className="mr-account-item-icon" aria-hidden="true"><GearIcon /></span>Settings
              </button>
              <button type="button" className="mr-account-item" onClick={() => openConsole('activity')}>
                <span className="mr-account-item-icon" aria-hidden="true"><ConsoleIcon /></span>Activity
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="mr-account-item" onClick={() => setMenuOpen(false)}>
                <span className="mr-account-item-icon" aria-hidden="true"><SignOutIcon /></span>Sign in
              </Link>
              <Link href="/register" className="mr-account-item" onClick={() => setMenuOpen(false)}>
                <span className="mr-account-item-icon" aria-hidden="true"><GuestGlyph /></span>Create account
              </Link>
            </>
          )}
          <button type="button" className="mr-account-item" onClick={() => openConsole('appearance')}>
            <span className="mr-account-item-icon" aria-hidden="true"><MoonIcon /></span>Appearance
          </button>
          {viewer?.role && viewer.role !== 'User' ? (
            <Link href="/admin" className="mr-account-item" onClick={() => setMenuOpen(false)}>
              <span className="mr-account-item-icon" aria-hidden="true"><ConsoleIcon /></span>{viewer.role} console
            </Link>
          ) : null}
          {signOutError ? <p className="mr-account-error" role="alert">{signOutError}</p> : null}
          {signedIn ? <button
            type="button"
            className="mr-account-item mr-account-item-signout"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            <span className="mr-account-item-icon" aria-hidden="true"><SignOutIcon /></span>{signingOut ? 'Signing out…' : 'Sign out'}
          </button> : null}
        </div>
      ) : null}
    </div>
  )
}

function initialOf(viewer: AccountViewer): string {
  const name = viewer.name?.trim()
  if (name) return name.charAt(0).toUpperCase()
  const email = viewer.email?.trim()
  if (email) return email.charAt(0).toUpperCase()
  return '?'
}

function GuestGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 6.6 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 2.6 15H2.5a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10.6 3V2.9a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15.4 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 21.4 8.6v.09a2 2 0 0 1 0 4h-.09Z" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 9 9c-4.97 0-9-4.03-9-9Z" />
    </svg>
  )
}

function ConsoleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  )
}
