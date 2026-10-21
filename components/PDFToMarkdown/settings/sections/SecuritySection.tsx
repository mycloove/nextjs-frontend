'use client'

import Link from 'next/link'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SettingsContext } from '../settingsContext'
import { GuestGate, PaneHead, StatusLine } from './parts'

/** A credential field with a real show/hide control (keyboard-reachable). */
function PasswordField({
  label,
  value,
  autoComplete,
  onChange,
}: {
  label: string
  value: string
  autoComplete: string
  onChange: (next: string) => void
}) {
  const [visible, setVisible] = useState(false)
  return (
    <label className="mr-cfg-field">
      <span className="mr-cfg-field-label">{label}</span>
      <span className="mr-cfg-password">
        <input
          className="mr-cfg-input"
          type={visible ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          aria-label={label}
          required
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="mr-cfg-reveal"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <path d="m1 1 22 22" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </span>
    </label>
  )
}

/**
 * Security — password change, done entirely client-side against Supabase.
 *
 * There is no server route and no service key in the browser: the owner proves
 * identity by re-authenticating with their current password, and only then may
 * `updateUser({ password })` replace it. An OAuth-only account has no password
 * identity, so the form is replaced by a truthful note rather than a field the
 * account can never satisfy.
 */
export default function SecuritySection({ ctx }: { ctx: SettingsContext }) {
  const viewer = ctx.viewer
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  if (!viewer) {
    return (
      <section className="mr-cfg-section">
        <PaneHead eyebrow="Account" title="Security" hint="Password and sign-in credentials." />
        <GuestGate
          title="Sign in to manage security"
          hint="Password changes require an active session, so they cannot be made from a signed-out console."
        >
          <Link href="/login" className="mr-cfg-btn mr-cfg-btn-primary">Sign in</Link>
        </GuestGate>
      </section>
    )
  }

  const email = viewer.email

  if (!email) {
    return (
      <section className="mr-cfg-section">
        <PaneHead eyebrow="Account" title="Security" hint="Password and sign-in credentials." />
        <p className="mr-cfg-note">This account signs in with a linked identity, so there is no password to change here.</p>
      </section>
    )
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError(''); setDone(false)
    if (next.length < 8) { setError('Use at least 8 characters for the new password.'); return }
    if (next !== confirm) { setError('The new passwords do not match.'); return }
    setBusy(true)
    try {
      const supabase = createClient()
      const reauth = await supabase.auth.signInWithPassword({ email, password: current })
      if (reauth.error) { setError('Your current password is not correct.'); return }
      const updated = await supabase.auth.updateUser({ password: next })
      if (updated.error) { setError(updated.error.message); return }
      setCurrent(''); setNext(''); setConfirm('')
      setDone(true)
    } catch {
      setError('Could not change the password. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mr-cfg-section">
      <PaneHead eyebrow="Account" title="Security" hint="Confirm your current password, then choose a new one." />

      <form className="mr-cfg-form" onSubmit={submit}>
        <PasswordField label="Current password" value={current} autoComplete="current-password" onChange={setCurrent} />
        <PasswordField label="New password" value={next} autoComplete="new-password" onChange={setNext} />
        <PasswordField label="Confirm new password" value={confirm} autoComplete="new-password" onChange={setConfirm} />

        <div className="mr-cfg-actions">
          <StatusLine error={error} saved={done} savedLabel="Password updated" />
          <button className="mr-cfg-btn mr-cfg-btn-primary" type="submit" disabled={busy || !current || !next || !confirm}>
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </div>
      </form>
    </section>
  )
}
