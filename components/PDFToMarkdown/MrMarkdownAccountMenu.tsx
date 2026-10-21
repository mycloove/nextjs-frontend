'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { SettingsSectionId } from './settings/settingsContext'
import type { AccountViewer } from '@/lib/account/useAccountViewer'

/**
 * Mr. Markdown's account control for the workspace topbar.
 *
 * Instrument concept (surface 4, "the master workbench"): the operator's
 * identity seal on the bench. It replaces the previously hardcoded "JS" chip
 * with the real signed-in user — avatar photo when they have one, otherwise the
 * initial of their display name (falling back to their email) — and is the entry
 * point to the calibration console.
 *
 * Identity is resolved once by `Workspace` (the surface) and passed in, so this
 * seal and the console read the *same* `useAccountViewer` instance: a name or
 * avatar change in a console pane lands here without a reload. This control owns
 * only the trigger and its small menu — the console itself is rendered by
 * `Workspace` (in-tree, so it keeps the workspace palette).
 *
 * Guests get the same affordance as the rest of the product: the placeholder
 * seal opens the console directly at the workspace pane they can actually set.
 */
export default function MrMarkdownAccountMenu({
  status,
  viewer,
  signOut,
  onOpenSettings,
}: {
  status: 'loading' | 'ready'
  viewer: AccountViewer | null
  signOut: () => Promise<void>
  onOpenSettings: (section: SettingsSectionId) => void
}) {
  const signedIn = Boolean(viewer)
  const [menuOpen, setMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const openConsole = (section: SettingsSectionId) => {
    setMenuOpen(false)
    onOpenSettings(section)
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    setMenuOpen(false)
    await signOut()
    setSigningOut(false)
  }

  // While the session resolves, keep the seal's footprint with a quiet
  // placeholder so the topbar row never reflows (no "JS" flash).
  if (status === 'loading') {
    return <span className="mr-avatar mr-avatar-pending" aria-hidden="true" />
  }

  return (
    <div className="mr-account-wrap" ref={wrapRef}>
      <button
        type="button"
        className="mr-avatar"
        onClick={() => (signedIn ? setMenuOpen((open) => !open) : openConsole('appearance'))}
        aria-label="Account and settings"
        aria-haspopup={signedIn ? 'menu' : 'dialog'}
        aria-expanded={signedIn ? menuOpen : undefined}
        // Suppress the hover tooltip while the menu is open so it never overlaps it.
        // The `data-tooltip` rule is the single visible label; a native `title`
        // here would render the browser's own tooltip on top of it (two labels).
        data-tooltip={menuOpen ? undefined : 'Account & settings'}
      >
        {signedIn && viewer?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- small owner-scoped avatar; a plain <img> avoids coupling next/image to the storage host
          <img className="mr-avatar-img" src={viewer.avatarUrl} alt="" loading="lazy" />
        ) : signedIn && viewer ? (
          initialOf(viewer)
        ) : (
          <GuestGlyph />
        )}
      </button>

      {signedIn && menuOpen ? (
        <div className="mr-account-menu" role="menu">
          <div className="mr-account-identity">
            <span className="mr-account-name">{viewer?.name?.trim() || viewer?.email?.split('@')[0] || 'Account'}</span>
            <span className="mr-account-email">{viewer?.email}</span>
            {viewer?.role ? <span className="mr-account-role">{viewer.role}</span> : null}
          </div>

          <button type="button" role="menuitem" className="mr-account-item" onClick={() => openConsole('identity')}>
            <span className="mr-account-item-icon" aria-hidden="true"><GearIcon /></span>Settings
          </button>
          <button type="button" role="menuitem" className="mr-account-item" onClick={() => openConsole('appearance')}>
            <span className="mr-account-item-icon" aria-hidden="true"><MoonIcon /></span>Appearance
          </button>
          {viewer?.role && viewer.role !== 'User' ? (
            <Link href="/admin" role="menuitem" className="mr-account-item" onClick={() => setMenuOpen(false)}>
              <span className="mr-account-item-icon" aria-hidden="true"><ConsoleIcon /></span>{viewer.role} console
            </Link>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="mr-account-item mr-account-item-signout"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            <span className="mr-account-item-icon" aria-hidden="true"><SignOutIcon /></span>{signingOut ? 'Signing out…' : 'Sign out'}
          </button>
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
