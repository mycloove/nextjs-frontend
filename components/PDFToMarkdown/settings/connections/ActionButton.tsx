'use client'

import KineticSphere from '@/components/KineticSphere'
import type { ReactNode } from 'react'

/**
 * The dock's one action control.
 *
 * Every button in Connections goes through here so a working button looks the
 * same everywhere: the house **kinetic sphere** (`components/KineticSphere.tsx`,
 * the same loader PDF→Images already uses) sits in the button's own ink while the
 * action runs. The sphere is a field of equal dots with no depth cue, so it reads
 * as honest indeterminate work — it never implies a percentage the server did not
 * report.
 *
 * Two deliberate legibility rules, which is why this exists at all:
 *  - **busy keeps full contrast.** A disabled-looking filled button (the old
 *    `opacity: .5`) turns white-on-accent text into a washed-out grey. A *busy*
 *    button here stays fully inked and marks itself with `aria-busy`, so the
 *    label is readable exactly when the owner is watching it.
 *  - **disabled is a palette, not an opacity.** An unavailable action gets muted
 *    colours that still pass contrast, instead of dimming a coloured fill.
 */

export type ActionVariant = 'primary' | 'default' | 'quiet' | 'danger' | 'link'

export default function ActionButton({
  children,
  onClick,
  variant = 'default',
  loading = false,
  disabled = false,
  busyLabel,
  iconOnlyWhileLoading = false,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: ActionVariant
  loading?: boolean
  disabled?: boolean
  /** Label shown while loading, when the work needs naming (e.g. "Opening GitHub"). */
  busyLabel?: string
  /**
   * Swap the label for the sphere alone while loading (the width contracts to the
   * loader and returns when the work ends). The original label stays as the
   * accessible name via an `aria-label` + a screen-reader-only node, so the
   * control is never an unlabelled icon.
   */
  iconOnlyWhileLoading?: boolean
  title?: string
}) {
  const variantClass =
    variant === 'primary' ? 'mr-cfg-btn-primary'
      : variant === 'quiet' ? 'mr-cfg-btn-quiet'
        : variant === 'danger' ? 'mr-cfg-gh-danger'
          : ''
  const base = variant === 'link' ? 'mr-cfg-gh-linkbtn mr-cfg-gh-action' : `mr-cfg-btn mr-cfg-gh-action ${variantClass}`.trim()
  const label = (loading && busyLabel) || children
  const iconOnly = loading && iconOnlyWhileLoading
  const sphereSize = variant === 'link' ? (iconOnly ? 14 : 12) : 16

  return (
    <button
      type="button"
      className={base}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-icon-only={iconOnly || undefined}
      title={title}
    >
      {loading ? (
        <KineticSphere
          className="mr-cfg-gh-sphere"
          size={sphereSize}
          points={variant === 'link' ? 40 : 48}
          dot={variant === 'link' ? 0.7 : 0.85}
        />
      ) : null}
      {iconOnly ? (
        <span className="mr-cfg-sr-only">{label}</span>
      ) : (
        <span className="mr-cfg-gh-action-label">{label}</span>
      )}
    </button>
  )
}
