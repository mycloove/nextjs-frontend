'use client'

import type { ReactNode } from 'react'

/**
 * The dock's inline notice — the message a former toast would have shown, now
 * living in the panel next to the control that produced it.
 *
 * Every notice is dismissible: transient feedback the owner has read should be
 * something they can clear, not something that sits in the panel until the next
 * action overwrites it. The dismiss control is a real button with an accessible
 * name, so it is reachable by keyboard and announced by a screen reader.
 *
 * Tone is limited to the two states this surface ever reports — a confirmed
 * outcome (`success`) and a refusal (`error`) — so feedback can never invent a
 * third mood.
 */
export default function StatusNotice({
  tone = 'success',
  onDismiss,
  children,
}: {
  tone?: 'success' | 'error'
  onDismiss?: () => void
  children: ReactNode
}) {
  return (
    <div className={`mr-cfg-gh-notice is-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="mr-cfg-gh-notice-icon" aria-hidden="true">{tone === 'success' ? '✓' : '!'}</span>
      <span className="mr-cfg-gh-notice-body">{children}</span>
      {onDismiss ? (
        <button type="button" className="mr-cfg-gh-notice-dismiss" onClick={onDismiss} aria-label="Dismiss">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      ) : null}
    </div>
  )
}
