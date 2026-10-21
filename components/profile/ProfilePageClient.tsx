'use client'

import { useEffect, useState } from 'react'
import ActivitySection from './ActivitySection'
import ChangePasswordSection from './ChangePasswordSection'
import ProfileInfoSection from './ProfileInfoSection'
import { fetchProfile, type Profile } from './profileApi'
import styles from './profile.module.css'

/**
 * Full-page profile for the deep-linkable `/profile` route. Same three section
 * components as the slide-over, laid out as a document rather than a panel, so a
 * bookmarked or refreshed URL shows the same controls the menu opens.
 */
export default function ProfilePageClient() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetchProfile()
      .then((value) => { if (alive) setProfile(value) })
      .catch(() => { if (alive) setError('Could not load your profile.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  if (loading) {
    return <main className={styles.page}><p className={styles.muted} role="status">Loading your profile…</p></main>
  }
  if (error || !profile) {
    return <main className={styles.page}><p className={styles.error} role="alert">{error || 'Your profile could not be found.'}</p></main>
  }

  return (
    <main className={styles.page}>
      <header className={styles.pageHead}>
        <p className={styles.pageEyebrow}>Account</p>
        <h1 className={styles.pageTitle}>{profile.name?.trim() || profile.email?.split('@')[0] || 'Your profile'}</h1>
        {profile.email ? <p className={styles.pageEmail}>{profile.email}</p> : null}
      </header>

      <div className={styles.pageSections}>
        <ProfileInfoSection profile={profile} onProfileChange={setProfile} />
        <ChangePasswordSection email={profile.email} />
        <ActivitySection />
      </div>
    </main>
  )
}
