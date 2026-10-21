'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { removeAvatar, saveProfileName, uploadAvatar, type Profile } from '@/components/profile/profileApi'
import type { SettingsContext } from '../settingsContext'
import { GuestGate, PaneHead, StatusLine } from './parts'

const MAX_BYTES = 2 * 1024 * 1024
const ACCEPT = 'image/png,image/jpeg,image/webp'

/**
 * Identity — the login data the console shares with the rest of the product:
 * display name, email and profile photo. This is the one pane that is not
 * Mr. Markdown-specific; it reads and writes the same owner-scoped
 * `/api/profile` and `/api/profile/avatar` routes the global account control
 * uses, through the shared `profileApi`. Presentation is still the console's
 * own (workspace register), never the global modal's markup.
 *
 * Every successful write calls `ctx.refreshViewer()` so the topbar seal — which
 * reads the *same* `useAccountViewer` instance — updates without a reload.
 */
export default function IdentitySection({ ctx }: { ctx: SettingsContext }) {
  const viewer = ctx.viewer
  const [name, setName] = useState(viewer?.name ?? '')
  const [photo, setPhoto] = useState<string | null>(viewer?.avatarUrl ?? null)
  const [busy, setBusy] = useState<'name' | 'photo' | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const savedTimer = useRef<number | null>(null)

  useEffect(() => { setName(viewer?.name ?? '') }, [viewer?.name])
  useEffect(() => { setPhoto(viewer?.avatarUrl ?? null) }, [viewer?.avatarUrl])
  useEffect(() => () => { if (savedTimer.current) window.clearTimeout(savedTimer.current) }, [])

  if (!viewer) {
    return (
      <section className="mr-cfg-section">
        <PaneHead eyebrow="Account" title="Identity" hint="How this account is identified across the product." />
        <GuestGate
          title="You are signed out"
          hint="Sign in to set a display name and photo, and to keep your conversions on this account."
        >
          <Link href="/login" className="mr-cfg-btn mr-cfg-btn-primary">Sign in</Link>
        </GuestGate>
      </section>
    )
  }

  const displayName = name.trim() || viewer.email?.split('@')[0] || 'Operator'
  const initial = (displayName[0] ?? '?').toUpperCase()
  const dirty = name.trim() !== (viewer.name ?? '')

  const flash = () => {
    setSaved(true)
    if (savedTimer.current) window.clearTimeout(savedTimer.current)
    savedTimer.current = window.setTimeout(() => setSaved(false), 2400)
  }

  const applyProfile = (profile: Profile) => {
    setName(profile.name ?? '')
    setPhoto(profile.avatar_url ?? null)
    ctx.refreshViewer()
  }

  const submitName = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || !dirty) return
    setBusy('name'); setError(''); setSaved(false)
    try {
      applyProfile(await saveProfileName(name))
      flash()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your name.')
    } finally {
      setBusy(null)
    }
  }

  const onPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_BYTES) { setError('Image is too large (max 2 MB).'); return }
    setBusy('photo'); setError(''); setSaved(false)
    try {
      applyProfile(await uploadAvatar(file))
      flash()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not upload your photo.')
    } finally {
      setBusy(null)
    }
  }

  const onRemove = async () => {
    setBusy('photo'); setError(''); setSaved(false)
    try {
      applyProfile(await removeAvatar())
      flash()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove your photo.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mr-cfg-section">
      <PaneHead eyebrow="Account" title="Identity" hint="Name, email and the photo that seals your account on the bench." />

      <div className="mr-cfg-seal-row">
        <span className="mr-cfg-seal" aria-hidden="true">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- owner-scoped avatar; a plain <img> avoids coupling next/image to the storage host
            <img className="mr-cfg-seal-img" src={photo} alt="" />
          ) : (
            initial
          )}
        </span>
        <div className="mr-cfg-seal-meta">
          <strong>{displayName}</strong>
          <span>{photo ? 'Photo set' : 'Showing your initial'}</span>
        </div>
        <div className="mr-cfg-seal-actions">
          <input
            ref={inputRef}
            className="mr-cfg-file-input"
            type="file"
            accept={ACCEPT}
            onChange={onPick}
            disabled={busy === 'photo'}
          />
          <button
            type="button"
            className="mr-cfg-btn"
            onClick={() => inputRef.current?.click()}
            disabled={busy === 'photo'}
          >
            {busy === 'photo' ? 'Working…' : photo ? 'Replace photo' : 'Upload photo'}
          </button>
          {photo ? (
            <button type="button" className="mr-cfg-btn mr-cfg-btn-quiet" onClick={onRemove} disabled={busy === 'photo'}>
              Remove
            </button>
          ) : null}
        </div>
      </div>

      <form className="mr-cfg-form" onSubmit={submitName}>
        <label className="mr-cfg-field">
          <span className="mr-cfg-field-label">Display name</span>
          <input
            className="mr-cfg-input"
            type="text"
            value={name}
            maxLength={80}
            autoComplete="nickname"
            placeholder="Add a display name"
            onChange={(event) => { setName(event.target.value); setSaved(false) }}
          />
        </label>

        <label className="mr-cfg-field">
          <span className="mr-cfg-field-label">Email</span>
          <input
            className="mr-cfg-input mr-cfg-input-readonly"
            type="email"
            value={viewer.email ?? '—'}
            readOnly
            aria-readonly="true"
          />
        </label>

        <div className="mr-cfg-actions">
          <StatusLine error={error} saved={saved} />
          {viewer.role ? <span className="mr-cfg-pill">{viewer.role}</span> : null}
          <button className="mr-cfg-btn mr-cfg-btn-primary" type="submit" disabled={busy === 'name' || !dirty}>
            {busy === 'name' ? 'Saving…' : 'Save name'}
          </button>
        </div>
      </form>
    </section>
  )
}
