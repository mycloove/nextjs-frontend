import { adminEntryRedirect, requireAdmin } from '@/lib/usage/admin'
import { readAdminGuests, readAdminUsers } from '@/lib/usage/controls'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import UsersDesk, { type UsersTab } from '../UsersDesk'
import { shortDate, shortId } from '../format'

export const metadata: Metadata = {
  title: 'Users',
  description: 'Signed-in accounts and guest browsers, with the calls they have made against their caps.',
}

const PAGE_SIZE = 25

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const gate = await requireAdmin()
  const entry = adminEntryRedirect(gate)
  if (entry) redirect(entry)
  if (!gate.ok) {
    return (
      <UsersDesk
        tab="accounts"
        query=""
        page={1}
        accounts={[]}
        accountTotal={0}
        browsers={[]}
        browserTotal={0}
        loadError={gate.message ?? 'The bench is unavailable.'}
        canEditUsers={false}
      />
    )
  }

  const params = await searchParams
  const rawTab = typeof params.tab === 'string' ? params.tab : ''
  const tab: UsersTab = rawTab === 'browsers' ? 'browsers' : 'accounts'
  const query = typeof params.q === 'string' ? params.q.slice(0, 200) : ''
  const rawPage = typeof params.p === 'string' ? Number.parseInt(params.p, 10) : 1
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1

  /*
   * Both readers fail open to an empty list rather than throwing: this page is
   * display only, and an operator needs it most when the store is misbehaving.
   * The desk reports which read came back empty so a blank table never passes
   * itself off as "nobody has used anything".
   */
  const [accountsRead, browsersRead] = await Promise.all([
    readAdminUsers({ query, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE }),
    readAdminGuests({ take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE }),
  ])

  const loadError = [accountsRead, browsersRead]
    .filter((read) => read.degraded)
    .map((read) => read.message)
    .join(' ')

  return (
    <UsersDesk
      tab={tab}
      query={query}
      page={page}
      accounts={accountsRead.data.rows.map((row) => ({
        id: row.id,
        primary: row.email ?? 'No email on file',
        sub: `Account ${shortId(row.id)} · seated ${shortDate(row.created_at)}`,
        kind: 'account',
        active: row.active,
        created: row.created_at,
        calls_24h: row.calls_24h,
        calls_total: row.calls_total,
      }))}
      accountTotal={accountsRead.data.total}
      browsers={browsersRead.data.rows.map((row) => ({
        id: row.anon_id,
        primary: 'Anonymous browser',
        sub: `Cookie ${shortId(row.anon_id)}`,
        kind: 'browser',
        created: '',
        calls_24h: row.calls_24h,
        calls_total: row.calls_total,
      }))}
      browserTotal={browsersRead.data.total}
      loadError={loadError}
      canEditUsers={gate.role === 'Owner' || gate.role === 'Operator'}
    />
  )
}
