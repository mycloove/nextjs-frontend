'use client'

import type { ReactNode } from 'react'

/**
 * Shared, dependency-free presentation parts for the calibration console's
 * sections.
 *
 * They exist so every pane's head, status line and switch read identically
 * without those sections importing each other. Nothing here knows about any
 * specific setting — it is markup + classes only, styled by
 * `11-settings-console.css`.
 */

export function PaneHead({ eyebrow, title, hint }: { eyebrow?: string; title: string; hint?: string }) {
  return (
    <header className="mr-cfg-head">
      {eyebrow ? <span className="mr-cfg-eyebrow">{eyebrow}</span> : null}
      <h2 className="mr-cfg-title">{title}</h2>
      {hint ? <p className="mr-cfg-hint">{hint}</p> : null}
    </header>
  )
}

export function StatusLine({ error, saved, savedLabel = 'Saved' }: { error?: string; saved?: boolean; savedLabel?: string }) {
  if (error) return <p className="mr-cfg-error" role="alert">{error}</p>
  if (saved) return <p className="mr-cfg-saved" role="status">{savedLabel}</p>
  return null
}

/**
 * A labeled switch. `role="switch"` + `aria-checked` so assistive tech announces
 * on/off state, and the whole row toggles so the hit target is the row, not a
 * 30px track.
 */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className="mr-cfg-row mr-cfg-toggle-row"
      onClick={() => onChange(!checked)}
    >
      <span className="mr-cfg-row-copy">
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
      <span className={`mr-cfg-switch ${checked ? 'is-on' : ''}`} aria-hidden="true">
        <span className="mr-cfg-switch-knob" />
      </span>
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: { id: T; label: string; hint?: string }[]
  onChange: (next: T) => void
  ariaLabel: string
}) {
  return (
    <div className="mr-cfg-segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            className={`mr-cfg-segment ${active ? 'is-active' : ''}`}
            onClick={() => onChange(option.id)}
          >
            <span className="mr-cfg-segment-label">{option.label}</span>
            {option.hint ? <span className="mr-cfg-segment-hint">{option.hint}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

export function GuestGate({ title, hint, children }: { title: string; hint: string; children?: ReactNode }) {
  return (
    <div className="mr-cfg-gate">
      <p className="mr-cfg-gate-title">{title}</p>
      <p className="mr-cfg-gate-hint">{hint}</p>
      {children}
    </div>
  )
}
