import ProfilePageClient from '@/components/profile/ProfilePageClient'
import styles from '@/components/profile/profile.module.css'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Profile — mycloove' }

/**
 * Deep-linkable profile page. Auth-gated on the server: a signed-out visitor is
 * sent to the login screen and returned here afterwards. The controls themselves
 * are the same section components the topbar slide-over uses.
 */
export default async function ProfilePage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login?next=/profile')

  return (
    <div className={styles.pageShell}>
      <ProfilePageClient />
    </div>
  )
}
