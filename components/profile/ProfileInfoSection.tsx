'use client'

import { useEffect, useState } from 'react'
import { saveProfileName, type Profile } from './profileApi'
import styles from './profile.module.css'

/**
 * Identity section: the editable display name and the read-only email.
 *
 * The email is fixed by Supabase Auth and shown as data, not a field — the
 * register is "here is your account", and only the name has a Save affordance,
 * so it is unambiguous which value can change.
 */
export default function ProfileInfoSection({
  profile,
  onProfileChange,
  initialFocus = false,
}: {
  profile: Profile
  onProfileChange: (profile: Profile) => void
  initialFocus?: boolean
}) {
  const [name, setName] = useState(profile.name ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setName(profile.name ?? '')
  }, [profile.name])

  const dirty = name.trim() !== (profile.name ?? '')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving || !dirty) return
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const updated = await saveProfileName(name)
      onProfileChange(updated)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2400)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your name.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={styles.section} onSubmit={submit}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Profile</h3>
        <p className={styles.sectionHint}>How your account is identified across mycloove.</p>
      </div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Username</span>
        <input
          className={styles.input}
          type="text"
          value={name}
          maxLength={80}
          placeholder="Add a display name"
          autoComplete="nickname"
          autoFocus={initialFocus}
          onChange={(event) => { setName(event.target.value); setSaved(false) }}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Email</span>
        <input className={`${styles.input} ${styles.inputReadonly}`} type="email" value={profile.email ?? '—'} readOnly aria-readonly="true" />
      </label>

      <div className={styles.actions}>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {saved ? <p className={styles.saved} role="status">Saved</p> : null}
        <button className={styles.primaryBtn} type="submit" disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}
