'use client'

import { useState } from 'react'
import { BenchToasts, useBenchToasts } from './BenchToast'
import BenchIcon from './BenchIcon'
import { ConfirmDialog, type ConfirmSpec } from './ConfirmDialog'
import { shortDate, shortId } from './format'
import styles from './bench.module.css'
import view from './people.module.css'
import type { AppRole } from '@/lib/supabase/roles'

/**
 * Exactly what `/api/admin/admins` returns. Kept separate from the display row
 * on purpose: the API has no pre-formatted date, and typing it as though it did
 * would let a future reader trust `created_label` off the wire when only the
 * server ever computes it.
 */
export type AdminSeat = {
  id: string
  email: string | null
  active: boolean
  role: AppRole
  created_at: string
}

export type AdminRow = AdminSeat & {
  /** Pre-formatted on the server; see app/admin/format.ts. */
  created_label: string
}

export default function PeopleDesk({
  initialAdmins,
  currentUserId,
  loadError,
}: {
  initialAdmins: AdminRow[]
  currentUserId: string
  loadError: string
}) {
  const [admins, setAdmins] = useState(initialAdmins)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [seatRole, setSeatRole] = useState<'Owner' | 'Operator' | 'Viewer'>('Operator')
  const [token, setToken] = useState('')
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState('')
  const [ask, setAsk] = useState<ConfirmSpec | null>(null)
  const [pending, setPending] = useState<{ row: AdminRow; action: 'withdraw' | 'remove' } | null>(null)
  const { toasts, push, dismiss } = useBenchToasts()

  /*
   * Client-side filter only. listAdminRecords is unbounded, but admin seats
   * number in single digits on every real deployment, so a server query +
   * pager here would be machinery with no traffic behind it. If seats ever
   * grow past a screenful, lift this to the /api/admin/admins reader first.
   */
  const visible = search.trim()
    ? admins.filter((row) => (row.email ?? '').toLowerCase().includes(search.trim().toLowerCase()))
    : admins

  const upsert = (row: AdminRow) => {
    setAdmins((current) => {
      const rest = current.filter((item) => item.id !== row.id)
      return [...rest, row].sort((a, b) => a.created_at.localeCompare(b.created_at))
    })
  }

  const seat = async () => {
    setBusyId('create')
    try {
      const response = await fetch('/api/admin/admins', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Only the open-bootstrap call reads this; on a sealed bench the
          // route ignores it. Sent always so the same form works both before
          // the first seat exists and after.
          ...(token.trim() ? { 'x-bootstrap-token': token.trim() } : {}),
        },
        body: JSON.stringify({ email, password, role: seatRole }),
      })
      const payload = await response.json() as AdminSeat & { error?: string }
      if (!response.ok || !payload.id) throw new Error(payload.error || 'Could not seat the admin')
      upsert({ ...payload, created_label: shortDate(payload.created_at) })
      setEmail('')
      setPassword('')
      setSeatRole('Operator')
      setToken('')
      push('ok', `${payload.email} can open the bench now.`)
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'Could not seat the admin')
    } finally {
      setBusyId('')
    }
  }

  const setActive = async (row: AdminSeat, active: boolean) => {
    setBusyId(row.id)
    try {
      const response = await fetch('/api/admin/admins', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, active }),
      })
      const payload = await response.json() as { admin?: AdminSeat; error?: string }
      if (!response.ok || !payload.admin) throw new Error(payload.error || 'Could not update the admin')
      upsert({ ...payload.admin, created_label: shortDate(payload.admin.created_at) })
      push(
        'ok',
        active
          ? `${payload.admin.email} can sign in again.`
          : `${payload.admin.email} is turned off. Sign-in stops until you activate them.`,
      )
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'Could not update the admin')
    } finally {
      setBusyId('')
    }
  }

  const confirmWithdraw = (row: AdminRow) => {
    const activeCount = admins.filter((item) => item.active).length
    setAsk({
      eyebrow: 'Turn off sign-in',
      title: `Turn off ${row.email || 'this admin'}?`,
      body:
        activeCount <= 1
          ? 'They are the last active seat. The bench refuses this so the deployment cannot be locked out.'
          : 'Their sign-in stops immediately and their seat stays on the list, so you can turn it back on without seating them again.',
      cancelLabel: 'Leave it on',
      confirmLabel: 'Turn off',
      tone: 'danger',
    })
    setPending({ row, action: 'withdraw' })
  }

  const confirmRemove = (row: AdminRow) => {
    setAsk({
      eyebrow: 'Delete the sign-in',
      title: `Delete ${row.email || 'this admin'}?`,
      body: 'The sign-in is removed and cannot be restored from the bench. Anything they converted stays counted. Type the email to confirm.',
      facts: [{ label: 'Account', value: row.email ?? 'no email' }],
      cancelLabel: 'Keep them',
      confirmLabel: 'Delete',
      tone: 'danger',
      typeToConfirm: row.email ?? row.id,
    })
    setPending({ row, action: 'remove' })
  }

  const dismissAsk = () => {
    setAsk(null)
    setPending(null)
  }

  const runAsk = async () => {
    if (!pending) return
    const { row, action } = pending
    setAsk((current) => (current ? { ...current, busy: true } : current))
    setBusyId(row.id)
    try {
      if (action === 'withdraw') {
        await setActive(row, false)
      } else {
        const response = await fetch('/api/admin/admins', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id }),
        })
        const payload = await response.json() as { id?: string; error?: string }
        if (!response.ok || !payload.id) throw new Error(payload.error || 'Could not delete the admin')
        setAdmins((current) => current.filter((item) => item.id !== payload.id))
        push('ok', `${row.email || 'That admin'} was removed.`)
      }
      setAsk(null)
      setPending(null)
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'Could not complete that')
    } finally {
      setBusyId('')
    }
  }

  const activeCount = admins.filter((row) => row.active).length

  return (
    <div className={`${styles.page} ${view.peoplePage}`}>
      <header className={`${styles.pageHead} ${view.peopleHead}`}>
        <div className={view.intro}>
          <p className={styles.pageEyebrow}>Team access</p>
          <h1 className={styles.pageTitle}>Admin seats</h1>
          <p className={`${styles.pageLead} ${view.lead}`}>
            Manage who can access this admin bench.
          </p>
        </div>
        <div className={view.seatCounter} aria-label={`${activeCount} of ${admins.length} admin seats active`}>
          <span className={view.counterLabel}>Active seats</span>
          <span className={`${styles.cellNum} ${view.counterValue}`}>{activeCount}<span> / {admins.length}</span></span>
        </div>
      </header>

      {loadError ? (
        <div className={styles.degraded} role="status">
          <BenchIcon className={styles.toastIcon} name="alert" />
          <div>
            <p className={styles.degradedTitle}>The seat list could not be read.</p>
            <p className={styles.degradedBody}>{loadError}</p>
          </div>
        </div>
      ) : null}

      <form
        className={`${styles.seatForm} ${view.seatForm}`}
        onSubmit={(event) => {
          event.preventDefault()
          void seat()
        }}
      >
        <div className={view.formHead}>
          <div>
            <p className={`${styles.pageEyebrow} ${view.formEyebrow}`}>Access management</p>
            <h2 className={view.formTitle}>Add a team member</h2>
          </div>
          <p className={view.formNote}>Set sign-in details and choose the right access level.</p>
        </div>
        <div className={view.formGrid}>
          <div className={`${styles.field} ${view.field}`}>
            <label className={styles.fieldLabel} htmlFor="seat-email">Email</label>
            <input
              id="seat-email"
              className={styles.input}
              type="email"
              autoComplete="off"
              placeholder="support@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className={`${styles.field} ${view.field}`}>
            <label className={styles.fieldLabel} htmlFor="seat-password">Password</label>
            <input
              id="seat-password"
              className={styles.input}
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              maxLength={72}
              required
            />
            <p className={`${styles.fieldHint} ${view.fieldHint}`}>
              Supabase Auth hashes it. This bench never stores the password.
            </p>
          </div>
          <div className={`${styles.field} ${view.field}`}>
            <label className={styles.fieldLabel} htmlFor="seat-role">Access level</label>
            <select id="seat-role" className={styles.select} value={seatRole} onChange={(event) => setSeatRole(event.target.value as typeof seatRole)}>
              <option value="Operator">Operator</option>
              <option value="Viewer">Viewer</option>
              <option value="Owner">Owner</option>
            </select>
            <p className={`${styles.fieldHint} ${view.fieldHint}`}>
              Operator can change tools and clear usage. Viewer can read. Owner can manage team access.
            </p>
          </div>
          <div className={`${styles.field} ${view.field}`}>
            <label className={styles.fieldLabel} htmlFor="seat-token">Bootstrap token</label>
            <input
              id="seat-token"
              className={styles.input}
              type="password"
              autoComplete="off"
              placeholder="Only for the first seat"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            <p className={`${styles.fieldHint} ${view.fieldHint}`}>
              Needed only while no admin exists and ADMIN_BOOTSTRAP_TOKEN is set. Ignored after that.
            </p>
          </div>
        </div>
        <div className={view.formFooter}>
          <p className={view.formFootnote}>
            Passwords are hashed by Supabase Auth. Bootstrap token is only needed when seating the first admin.
          </p>
          <button
            type="submit"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={busyId === 'create'}
          >
            {busyId === 'create' ? 'Seating…' : 'Add team member'}
          </button>
        </div>
      </form>

      <div className={`${styles.panel} ${view.seatsPanel}`}>
        <div className={`${styles.panelHead} ${view.seatsHead}`}>
          <div>
            <h2 className={styles.panelTitle}>Current seats</h2>
            <p className={styles.panelNote}>The last active seat is protected from sign-in being turned off.</p>
          </div>
          <span className={view.totalSeats}>{admins.length} {admins.length === 1 ? 'seat' : 'seats'}</span>
        </div>
        {admins.length > 4 ? (
          <div className={`${styles.toolbar} ${styles.seatSearchToolbar} ${view.seatFilter}`}>
            <input
              className={`${styles.searchInput} ${view.searchInput}`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter seats by email…"
              aria-label="Filter seats by email"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : null}
        {admins.length === 0 ? (
          <div className={styles.empty}>
            <h3 className={styles.emptyTitle}>No team members are seated yet.</h3>
            <p className={styles.emptyBody}>
              Seat one above. On a fresh deployment the very first seat is open to anyone who reaches this form.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className={styles.empty}>
            <h3 className={styles.emptyTitle}>No seat matches that filter.</h3>
            <p className={styles.emptyBody}>Clear the filter to see every seat again.</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Account</th>
                  <th className={styles.th}>Seated</th>
                  <th className={styles.th}>Status</th>
                  <th className={`${styles.th} ${view.actionsHeading}`}>Manage</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const self = row.id === currentUserId
                  const busy = busyId === row.id
                  return (
                    <tr key={row.id} className={`${styles.tr} ${view.seatRow}`}>
                      <td className={styles.td}>
                        <div className={styles.cellStack}>
                          <span className={`${styles.cellPrimary} ${view.accountEmail}`}>{row.email || 'No email'}</span>
                          <span className={`${styles.cellSub} ${view.role}`}>{row.role}</span>
                          <span className={self ? styles.cellSub : styles.cellSubMono}>
                            {self ? 'Signed in now' : shortId(row.id)}
                          </span>
                        </div>
                      </td>
                      <td className={`${styles.td} ${styles.cellNum}`}>{row.created_label}</td>
                      <td className={styles.td}>
                        <span className={`${styles.badge} ${row.active ? styles.badgeOn : styles.badgeOff}`}>
                          {row.active ? 'Active' : 'Off'}
                        </span>
                      </td>
                      <td className={`${styles.td} ${styles.actionsCell}`}>
                        <span className={styles.rowActions}>
                          {row.active ? (
                            <button
                              type="button"
                              className={`${styles.btn} ${styles.btnDanger}`}
                              onClick={() => confirmWithdraw(row)}
                              disabled={busy || self}
                              title={self ? 'You cannot turn off the seat you are using.' : undefined}
                            >
                              Turn off
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={styles.btn}
                              onClick={() => void setActive(row, true)}
                              disabled={busy}
                            >
                              Activate
                            </button>
                          )}
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.btnDanger}`}
                            onClick={() => confirmRemove(row)}
                            disabled={busy || self}
                            title={self ? 'You cannot delete the seat you are using.' : undefined}
                            aria-label={`Delete ${row.email || 'this admin'}`}
                          >
                            <BenchIcon className={styles.navIcon} name="trash" />
                          </button>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog spec={ask} onCancel={dismissAsk} onConfirm={() => void runAsk()} />
      <BenchToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
