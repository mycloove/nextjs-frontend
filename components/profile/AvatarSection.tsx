'use client'

import { useRef, useState } from 'react'
import { removeAvatar, uploadAvatar, type Profile } from './profileApi'
import styles from './profile.module.css'

const MAX_BYTES = 2 * 1024 * 1024
const ACCEPT = 'image/png,image/jpeg,image/webp'

/**
 * Avatar control: preview, upload and remove for the signed-in owner's photo.
 *
 * The preview is the same disc the account chip uses, so what the owner sets
 * here is exactly what they then see in every topbar. Uploads are validated and
 * normalised server-side (`/api/profile/avatar`); this panel only picks a file
 * and reports the result, keeping the safety floor in one place.
 */
export default function AvatarSection({
  profile,
  onProfileChange,
}: {
  profile: Profile
  onProfileChange: (profile: Profile) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const initial = (profile.name?.trim()?.[0] || profile.email?.[0] || '?').toUpperCase()

  const flash = () => {
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2400)
  }

  const onPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = '' // allow re-selecting the same file
    if (!file) return
    if (file.size > MAX_BYTES) {
      setError('Image is too large (max 2 MB).')
      return
    }
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      onProfileChange(await uploadAvatar(file))
      flash()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not upload your photo.')
    } finally {
      setBusy(false)
    }
  }

  const onRemove = async () => {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      onProfileChange(await removeAvatar())
      flash()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove your photo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Profile photo</h3>
        <p className={styles.sectionHint}>
          Shown on your account chip everywhere in mycloove. A square PNG, JPEG, or WebP up to 2 MB works best.
        </p>
      </div>

      <div className={styles.avatarRow}>
        <span className={`${styles.avatar} ${styles.avatarLarge}`} aria-hidden="true">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- owner-scoped avatar; a plain <img> avoids coupling next/image to the storage host
            <img className={styles.avatarImage} src={profile.avatar_url} alt="" />
          ) : (
            initial
          )}
        </span>
        <div className={styles.avatarMeta}>
          <strong>{profile.name?.trim() || profile.email?.split('@')[0] || 'Your account'}</strong>
          <span>{profile.avatar_url ? 'Photo uploaded' : 'No photo yet — showing your initial'}</span>
        </div>
      </div>

      <div className={styles.avatarActions}>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {saved ? <p className={styles.saved} role="status">Saved</p> : null}
        <input
          ref={inputRef}
          className={styles.avatarInput}
          type="file"
          accept={ACCEPT}
          onChange={onPick}
          disabled={busy}
        />
        <button type="button" className={styles.secondaryBtn} onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Working…' : profile.avatar_url ? 'Replace photo' : 'Upload photo'}
        </button>
        {profile.avatar_url ? (
          <button type="button" className={styles.secondaryBtn} onClick={onRemove} disabled={busy}>
            Remove
          </button>
        ) : null}
      </div>
    </div>
  )
}
