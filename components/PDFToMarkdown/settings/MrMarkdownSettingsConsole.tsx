'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { AccountViewer } from '@/lib/account/useAccountViewer'
import { visibleSectionGroups } from './settingsRegistry'
import type { SettingsContext, SettingsSectionId, WorkspacePreferences, ActiveDocument, OpenDocument, SourcedDocument } from './settingsContext'
import { SECTION_GROUP_ORDER } from './settingsContext'
import type { IntegrationProviderStatus } from './providerContract'

const GROUP_LABEL: Record<string, string> = {
  Account: 'Account',
  Workspace: 'Workspace',
  Connections: 'Connections',
}

/**
 * Mr. Markdown's settings console — the workspace's own "calibration console".
 *
 * Instrument concept (plan §8.3): the operator's bench, not a generic "Account
 * settings" screen. It renders **in-tree**, inside `.mr-markdown-workspace`, so
 * it reads the workspace palette tokens and `data-theme`; it is deliberately not
 * portalled to `<body>`, which would strand it on the global token set. Its one
 * signature motion is an origin-anchored unfold from the top-right seal, with a
 * staggered nav-rail reveal; everything else stays quiet, and reduced-motion
 * collapses it to an instant swap.
 *
 * It owns navigation (from the registry), focus trapping, scroll lock and the
 * shared identity/activity context. It contains no setting logic itself — that
 * lives in the sections, which only ever talk to the `SettingsContext` contract.
 *
 * Mounted by `Workspace` only while open, so mount/unmount is the open/close
 * lifecycle: the previously focused element (the topbar seal) is restored for
 * free, and no section state leaks between openings.
 */
export default function MrMarkdownSettingsConsole({
  initialSection,
  onClose,
  status,
  viewer,
  refreshViewer,
  signOut,
  preferences,
  patchPreferences,
  activeDocument,
  openDocument,
  sourcedDocuments,
  focusSourceId,
  editSourcedDocument,
  resetSourcedDocument,
}: {
  initialSection?: SettingsSectionId
  onClose: () => void
  status: 'loading' | 'ready'
  viewer: AccountViewer | null
  refreshViewer: () => void
  signOut: () => Promise<void>
  preferences: WorkspacePreferences
  patchPreferences: (patch: Partial<WorkspacePreferences>) => void
  activeDocument?: ActiveDocument
  openDocument?: OpenDocument
  sourcedDocuments?: SourcedDocument[]
  focusSourceId?: string
  editSourcedDocument?: (sourceId: string, markdown: string) => void
  resetSourcedDocument?: (sourceId: string, markdown: string, sha: string | null) => void
}) {
  const consoleRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const [activeId, setActiveId] = useState<SettingsSectionId>(initialSection ?? 'identity')
  // Reported up by the Connections section (which owns the network), rendered
  // here as the identity seal — the console does not fetch connection state
  // itself and cannot claim a status the section never observed.
  const [githubStatus, setGithubStatus] = useState<IntegrationProviderStatus | null>(null)

  const ctx: SettingsContext = {
    status,
    viewer,
    refreshViewer,
    signOut: async () => { await signOut(); onClose() },
    preferences,
    patchPreferences,
    activeDocument,
    openDocument,
    sourcedDocuments,
    focusSourceId,
    editSourcedDocument,
    resetSourcedDocument,
    githubStatus: githubStatus ?? undefined,
    reportGithubStatus: setGithubStatus,
    openSection: setActiveId,
    close: onClose,
  }

  // Cheap (a handful of specs) and must reflect the live identity, so it is
  // derived each render rather than memoised against a stable key it does not have.
  const groups = visibleSectionGroups(ctx)
  const flat = groups.flatMap((entry) => entry.specs)
  // The first group needs no leading separator: the identity header's own bottom
  // rule already divides it, so a rail hairline there just floats above Identity.
  const firstGroup = groups[0]?.group

  // If the requested section is not visible for this account (e.g. Security for
  // a guest), fall back rather than showing an empty pane. Derived, never a
  // state reset in an effect.
  const activeSpec = flat.find((spec) => spec.id === activeId) ?? flat[0]

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => {
      if (!consoleRef.current?.contains(document.activeElement)) consoleRef.current?.focus()
    }, 0)
    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      restoreRef.current?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusables = consoleRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables?.length) return
      const list = Array.from(focusables)
      const first = list[0]
      const last = list[list.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Arrow-key travel between rail items, so the nav is one reachable control.
  const onRailKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = Array.from(railRef.current?.querySelectorAll<HTMLButtonElement>('button[data-nav]') ?? [])
    if (!buttons.length) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown'
      ? buttons[Math.min(buttons.length - 1, (index < 0 ? -1 : index) + 1)]
      : buttons[Math.max(0, (index < 0 ? buttons.length : index) - 1)]
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  const displayName = viewer?.name?.trim() || viewer?.email?.split('@')[0] || 'Guest operator'
  const initial = (displayName[0] ?? '?').toUpperCase()
  const navIndex = flat.findIndex((spec) => spec.id === activeSpec?.id)

  return (
    <div className="mr-cfg-overlay" role="presentation" onClick={onClose}>
      <div
        ref={consoleRef}
        className="mr-cfg-console"
        role="dialog"
        aria-modal="true"
        aria-label="Mr. Markdown settings"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mr-cfg-identitybar">
          <span className="mr-cfg-identity-seal" aria-hidden="true">
            {viewer?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- owner-scoped avatar; a plain <img> avoids coupling next/image to the storage host
              <img className="mr-cfg-identity-img" src={viewer.avatarUrl} alt="" />
            ) : viewer ? (
              initial
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21a8 8 0 0 1 16 0" />
              </svg>
            )}
          </span>
          <span className="mr-cfg-identity-copy">
            <span className="mr-cfg-identity-name">{status === 'loading' ? 'Resolving…' : displayName}</span>
            <span className="mr-cfg-identity-sub">
              {viewer ? (viewer.email ?? 'Signed in') : 'Not signed in'}
              {viewer?.role ? <em className="mr-cfg-identity-role">{viewer.role}</em> : null}
              {githubStatus === 'connected' || githubStatus === 'needs_reauth' ? (
                <em
                  className={`mr-cfg-identity-github ${githubStatus === 'needs_reauth' ? 'is-amber' : ''}`}
                  title={githubStatus === 'connected' ? 'GitHub connected' : 'GitHub needs reconnecting'}
                >
                  <span className="mr-cfg-identity-github-dot" aria-hidden="true" />
                  GitHub
                </em>
              ) : null}
            </span>
          </span>
          <button type="button" className="mr-cfg-close" onClick={onClose} aria-label="Close settings">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <nav ref={railRef} className="mr-cfg-rail" aria-label="Settings sections" onKeyDown={onRailKeyDown}>
          {SECTION_GROUP_ORDER.map((group) => {
            const entry = groups.find((candidate) => candidate.group === group)
            if (!entry) return null
            return (
              <div className="mr-cfg-rail-group" key={group}>
                {group !== firstGroup ? <span className="mr-cfg-rail-divider" aria-hidden="true" /> : null}
                {entry.specs.map((spec) => {
                  const isActive = spec.id === activeSpec?.id
                  const globalIndex = flat.indexOf(spec)
                  return (
                    <button
                      key={spec.id}
                      type="button"
                      data-nav
                      className={`mr-cfg-rail-btn ${isActive ? 'is-active' : ''}`}
                      style={{ animationDelay: `${40 + Math.min(globalIndex, navIndex + 6) * 8}ms` }}
                      aria-current={isActive ? 'true' : undefined}
                      onClick={() => setActiveId(spec.id)}
                    >
                      <span className="mr-cfg-rail-icon" aria-hidden="true">{spec.icon}</span>
                      <span className="mr-cfg-rail-tip" aria-hidden="true">{spec.label}</span>
                      <span className="mr-cfg-sr-only">{GROUP_LABEL[group]}: {spec.label}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </nav>

        <div className="mr-cfg-pane" role="tabpanel" id="mr-cfg-pane" aria-label={activeSpec?.label}>
          {activeSpec ? activeSpec.render(ctx) : null}
        </div>

        <footer className="mr-cfg-foot">
          <span className="mr-cfg-foot-mark" aria-hidden="true">{activeSpec?.label}</span>
          {viewer ? (
            <button type="button" className="mr-cfg-foot-action" onClick={() => { void ctx.signOut() }}>
              Sign out
            </button>
          ) : (
            <Link href="/login" className="mr-cfg-foot-action mr-cfg-foot-action-primary" onClick={onClose}>
              Sign in
            </Link>
          )}
        </footer>
      </div>
    </div>
  )
}
