'use client'

import type { SettingsContext, WorkspacePreferences } from '../settingsContext'
import { PaneHead } from './parts'

type WorkspaceTheme = WorkspacePreferences['theme']

/**
 * Workspace appearance — the *workspace's own* theme (`mr-markdown-theme`),
 * completely separate from the global `smilepdf-theme` (CLAUDE.md §8 trap 6).
 * Changing it here repaints Mr. Markdown only; it is the same control the topbar
 * moon/sun button drives, so the two can never disagree.
 *
 * The workspace theme is binary by design — the topbar toggle is binary and the
 * stored value only ever holds `light` or `dark`. A first visit with nothing
 * stored resolves against `prefers-color-scheme` (see `views.tsx`), so the OS
 * preference is honoured once; from then on the operator's explicit choice wins.
 */
export default function WorkspaceAppearanceSection({ ctx }: { ctx: SettingsContext }) {
  const active = ctx.preferences.theme

  const tiles: { id: WorkspaceTheme; title: string; hint: string }[] = [
    { id: 'light', title: 'Paper', hint: 'Warm, high-contrast proofing surface.' },
    { id: 'dark', title: 'Slate', hint: 'Low-glare surface for long sessions.' },
  ]

  return (
    <section className="mr-cfg-section">
      <PaneHead
        eyebrow="Workspace"
        title="Appearance"
        hint="How Mr. Markdown itself looks. This is separate from the rest of the app’s theme."
      />

      <div className="mr-cfg-theme-grid" role="radiogroup" aria-label="Workspace theme">
        {tiles.map((tile) => {
          const isActive = tile.id === active
          return (
            <button
              key={tile.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              className={`mr-cfg-theme-tile ${isActive ? 'is-active' : ''}`}
              onClick={() => ctx.patchPreferences({ theme: tile.id })}
            >
              <span className={`mr-cfg-theme-preview mr-cfg-theme-preview-${tile.id}`} aria-hidden="true">
                <span className="mr-cfg-theme-preview-bar" />
                <span className="mr-cfg-theme-preview-line" />
                <span className="mr-cfg-theme-preview-line mr-cfg-theme-preview-line-short" />
                {isActive ? (
                  <span className="mr-cfg-theme-check">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                ) : null}
              </span>
              <span className="mr-cfg-theme-label">{tile.title}</span>
              <span className="mr-cfg-theme-hint">{tile.hint}</span>
            </button>
          )
        })}
      </div>

      <p className="mr-cfg-note">
        This changes the editor, rails and panels — not the marketing site or the other tools.
      </p>
    </section>
  )
}
