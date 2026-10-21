import { adminEntryRedirect, listPlatformAdmins, requireAdmin } from '@/lib/usage/admin'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import PeopleDesk, { type AdminRow } from './PeopleDesk'
import { shortDate } from './format'

export const metadata: Metadata = {
  title: 'Admins',
  description: 'Seat, withdraw, or delete the people who can open the bench.',
}

/**
 * `/admin` stays the Admins page. It is the target of the home nav button, the
 * login landing for an admin and the bench's own redirect, so relocating it would
 * silently change where every admin lands after signing in. Overview lives at
 * /admin/overview instead.
 */
export default async function AdminPeoplePage() {
  const gate = await requireAdmin()
  const entry = adminEntryRedirect(gate)
  if (entry) redirect(entry)
  if (gate.ok && gate.role !== 'Owner') redirect('/admin/overview')
  if (!gate.ok) {
    return (
      <PeopleDesk
        initialAdmins={[]}
        currentUserId=""
        loadError={gate.message ?? 'The bench is unavailable.'}
      />
    )
  }

  let admins: Awaited<ReturnType<typeof listPlatformAdmins>> = []
  let loadError = ''
  try {
    admins = await listPlatformAdmins()
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Could not load admins'
  }

  const seats: AdminRow[] = admins.map((row) => ({ ...row, created_label: shortDate(row.created_at) }))

  return <PeopleDesk initialAdmins={seats} currentUserId={gate.user.id} loadError={loadError} />
}
