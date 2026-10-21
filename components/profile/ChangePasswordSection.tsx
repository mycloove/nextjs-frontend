'use client'

import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'
import styles from './profile.module.css'

/**
 * A password input with a show/hide reveal control.
 *
 * The toggle is a real, keyboard-reachable button (not a decorative icon), so a
 * user can verify what they typed before submitting — the professional default
 * for any credential field. The input's accessible name comes from `aria-label`
 * rather than a wrapping `<label>`, so the reveal button is never swallowed by
 * the label's activation behaviour.
 */
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
    <div className={styles.field}>
      <span className={styles.fieldLabel} aria-hidden="true">{label}</span>
      <div className={styles.passwordWrap}>
        <input
          className={`${styles.input} ${styles.inputPassword}`}
          type={visible ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          aria-label={label}
          required
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className={styles.revealBtn}
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <path d="m1 1 22 22" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}

/**
 * Password change (D6), done entirely client-side with Supabase.
 *
 * There is no service key in the browser and no server route for this: the user
 * proves identity by re-authenticating with their current password
 * (`signInWithPassword`), and only then is `updateUser({ password })` allowed to
 * replace it. A wrong current password stops the flow before anything changes.
 *
 * The section renders nothing when the account has no password identity (an
 * OAuth-only account) — offering a field the account can never satisfy would be
 * a lie, not a feature.
 */
export default function ChangePasswordSection({ email }: { email: string | null }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  if (!email) {
    return (
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>Password</h3>
          <p className={styles.sectionHint}>This account signs in with a linked identity, so there is no password to change here.</p>
        </div>
      </div>
    )
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError('')
    setDone(false)
    if (next.length < 8) { setError('Use at least 8 characters for the new password.'); return }
    if (next !== confirm) { setError('The new passwords do not match.'); return }
    setBusy(true)
    try {
      const supabase = createClient()
      const reauth = await supabase.auth.signInWithPassword({ email, password: current })
      if (reauth.error) {
        setError('Your current password is not correct.')
        return
      }
      const updated = await supabase.auth.updateUser({ password: next })
      if (updated.error) {
        setError(updated.error.message)
        return
      }
      setCurrent(''); setNext(''); setConfirm('')
      setDone(true)
    } catch {
      setError('Could not change the password. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={styles.section} onSubmit={submit}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Password</h3>
        <p className={styles.sectionHint}>Confirm your current password, then choose a new one.</p>
      </div>

      <PasswordField label="Current password" value={current} autoComplete="current-password" onChange={setCurrent} />
      <PasswordField label="New password" value={next} autoComplete="new-password" onChange={setNext} />
      <PasswordField label="Confirm new password" value={confirm} autoComplete="new-password" onChange={setConfirm} />

      <div className={styles.actions}>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {done ? <p className={styles.saved} role="status">Password updated</p> : null}
        <button className={styles.primaryBtn} type="submit" disabled={busy || !current || !next || !confirm}>
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </div>
    </form>
  )
}
