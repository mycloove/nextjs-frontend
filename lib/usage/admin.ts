import { timingSafeEqual } from 'node:crypto'
import { canOperate, isAdminRole, type AppRole } from '@/lib/supabase/roles'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  deleteAdminRecord,
  deleteUserAccountData,
  hasAnyAdminProfile,
  listAdminRecords,
  readAccountForDeletion,
  readAccountStatus,
  seatAdminProfile,
  setAdminActive,
  setUserActive,
  type AdminAuditContext,
  UsageStoreMissing,
} from './store'

/**
 * Best-effort in-memory throttle for bench writes (B2-7). The 24 conversion
 * routes meter by quota; admin mutations have no quota, so a tight loop of
 * seat/deactivate/delete calls would each cost a Supabase Auth admin call.
 * 30 writes per minute per process is generous for a human operator and turns
 * a runaway script into 429s. Resets on restart — this is abuse friction, not
 * a security boundary; the real gate stays requireAdmin + bootstrap token.
 */
const ADMIN_WRITE_WINDOW_MS = 60_000
const ADMIN_WRITE_LIMIT = 30
let adminWriteMarks: number[] = []

export function checkAdminWriteRate(): boolean {
  const now = Date.now()
  adminWriteMarks = adminWriteMarks.filter((mark) => now - mark < ADMIN_WRITE_WINDOW_MS)
  if (adminWriteMarks.length >= ADMIN_WRITE_LIMIT) return false
  adminWriteMarks.push(now)
  return true
}


export async function requireAdmin() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return { ok: false as const, status: 401 as const, supabase }

  try {
    const status = await readAccountStatus(userData.user.id)
    if (!status.active) {
      return { ok: false as const, status: 403 as const, inactive: true as const, supabase }
    }
    if (isAdminRole(status.role)) {
      return { ok: true as const, supabase, user: userData.user, role: status.role }
    }
  } catch (error) {
    if (error instanceof UsageStoreMissing) {
      return { ok: false as const, status: 503 as const, supabase, message: error.message }
    }
    throw error
  }

  return { ok: false as const, status: 403 as const, supabase }
}

type AdminGate = Awaited<ReturnType<typeof requireAdmin>>

/** Turned-off admins go through the same login refusal as any other account. */
export function adminEntryRedirect(gate: AdminGate) {
  if (gate.ok || gate.status === 503) return null
  if ('inactive' in gate && gate.inactive) return '/login?error=inactive'
  return gate.status === 401 ? '/login' : '/'
}

export function adminRefusal(gate: Extract<AdminGate, { ok: false }>) {
  if ('inactive' in gate && gate.inactive) {
    return { error: 'This account is turned off.', status: 403 as const }
  }
  return { error: 'Admin only', status: gate.status }
}

/**
 * Creates or updates a Supabase Auth user and sets users.role to Admin.
 * GoTrue bcrypt-hashes the password into auth.users. The first call is open
 * while no Admin row exists; after that the route must call requireAdmin.
 *
 * Bootstrap hardening: when ADMIN_BOOTSTRAP_TOKEN is set, the open (no-admin)
 * branch additionally requires the caller to present it via the
 * x-bootstrap-token header. Timing-safe compare so a scanner cannot learn the
 * token byte-by-byte. When the env var is unset the behaviour is unchanged
 * (open bootstrap), because some self-host flows seat the first admin through
 * the UI with no shell access to set env vars first.
 */
export async function seatPlatformAdmin(email: string, password: string, role: 'Owner' | 'Operator' | 'Viewer' = 'Owner', audit?: AdminAuditContext): Promise<AdminSeat & { role: AppRole }> {
  const service = createServiceClient()
  if (!service) {
    throw new SeatAdminError(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Supabase Auth hashes the password; this API does not store it.',
      503,
    )
  }

  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  let userId = created.data.user?.id ?? null
  if (!userId) {
    const duplicate = /already|registered|exists/i.test(created.error?.message ?? '')
    if (!duplicate) {
      throw new SeatAdminError(created.error?.message || 'Could not create the admin', 400)
    }
    userId = await findUserIdByEmail(service, email)
    if (!userId) {
      throw new SeatAdminError('That email already exists, but the account could not be loaded.', 409)
    }
    const updated = await service.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    })
    if (updated.error) throw new SeatAdminError(updated.error.message, 400)
  }

  let seated
  try {
    seated = await seatAdminProfile(userId, email, role, audit)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not store the admin role'
    const status = error instanceof UsageStoreMissing ? 503 : 500
    throw new SeatAdminError(message, status)
  }

  return {
    id: seated.id,
    email: seated.email ?? email,
    role: seated.role === 'Admin' ? 'Owner' : seated.role as AppRole,
    active: seated.active,
    created_at: seated.createdAt.toISOString(),
  }
}

export type AdminSeat = {
  id: string
  email: string | null
  active: boolean
  role: AppRole
  created_at: string
}

export async function listPlatformAdmins(): Promise<AdminSeat[]> {
  const rows = await listAdminRecords()
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    active: row.active,
    role: row.role === 'Admin' ? 'Owner' : row.role as AppRole,
    created_at: row.createdAt.toISOString(),
  }))
}

async function guardAdminMutation(actorId: string, targetId: string) {
  if (actorId === targetId) {
    throw new SeatAdminError('You cannot withdraw or delete the admin you are signed in as.', 400)
  }
  const admins = await listAdminRecords()
  const target = admins.find((row) => row.id === targetId)
  if (!target) throw new SeatAdminError('That admin is not on the bench.', 404)
  const activeOwners = admins.filter((row) => row.active && (row.role === 'Owner' || row.role === 'Admin'))
  if (target.active && (target.role === 'Owner' || target.role === 'Admin') && activeOwners.length <= 1) {
    throw new SeatAdminError('The last active owner has to stay.', 400)
  }
  return target
}

export async function setPlatformAdminActive(actorId: string, targetId: string, active: boolean, audit?: AdminAuditContext) {
  await guardAdminMutation(actorId, targetId)
  const row = await setAdminActive(targetId, active, audit)
  return {
    id: row.id,
    email: row.email,
    active: row.active,
    role: row.role === 'Admin' ? 'Owner' : row.role as AppRole,
    created_at: row.createdAt.toISOString(),
  }
}

/**
 * Turns a regular account on or off from the users desk. The admin-seat
 * invariants do not apply here — an operator can never target an admin through
 * this path (setUserActive refuses bench roles) and can never target their own
 * admin account because their role makes them a bench account. A regular
 * account has no "last owner" invariant, so a plain toggle is honest.
 */
export async function setPlatformUserActive(actorId: string, targetId: string, active: boolean, audit?: AdminAuditContext) {
  if (actorId === targetId) {
    throw new SeatAdminError('You cannot change the account you are signed in as.', 400)
  }
  const row = await setUserActive(targetId, active, audit)
  return { id: row.id, email: row.email, active: row.active, role: row.role as AppRole, created_at: row.createdAt.toISOString() }
}

/**
 * Hard-deletes one regular account: the Supabase Auth sign-in first, then every
 * product-side row in a single transaction, plus the avatar objects.
 *
 * Order matters. Auth is deleted first because the two stores cannot share a
 * transaction: if Auth succeeds and the database write then fails, the person
 * can no longer sign in and a retry finishes the cleanup; if the database were
 * deleted first and Auth failed, the next sign-in would recreate an empty
 * profile and the "deleted" account would silently come back. An Auth failure
 * aborts before any product data is touched. A missing Auth user is treated as
 * already deleted so the retry path above actually converges.
 *
 * Admin seats are refused here on purpose. They are removed from the Admins
 * desk, where the "last active owner" invariant lives.
 */
export async function deletePlatformUser(
  actorId: string,
  targetId: string,
  audit?: AdminAuditContext,
) {
  if (actorId === targetId) {
    throw new SeatAdminError('You cannot delete the account you are signed in as.', 400)
  }

  let profile
  try {
    profile = await readAccountForDeletion(targetId)
  } catch (error) {
    throw accountWriteError(error, 'Could not read that account')
  }
  if (!profile) throw new SeatAdminError('That account is not here.', 404)
  if (isAdminRole(profile.role)) {
    throw new SeatAdminError('That is an admin account — manage it on the Admins desk.', 400)
  }

  const service = createServiceClient()
  if (!service) {
    throw new SeatAdminError('SUPABASE_SERVICE_ROLE_KEY is not set.', 503)
  }

  // Hard delete, not Supabase's soft-delete mode: the point of this action is
  // that the person can never be restored or sign in again.
  const removed = await service.auth.admin.deleteUser(targetId, false)
  if (removed.error && !/not found|does not exist/i.test(removed.error.message)) {
    throw new SeatAdminError(removed.error.message, 400)
  }

  /*
   * The avatar lives in object storage, outside the database transaction. It is
   * cleaned by listing the account's own folder rather than rebuilding the
   * avatar route's object path, so a future filename change cannot leave an
   * orphan behind. Best-effort: a missing object or an unconfigured bucket must
   * not block deleting the account itself.
   */
  const avatars = service.storage.from('avatars')
  const listed = await avatars.list(targetId)
  if (listed.error) {
    console.warn('Could not list a deleted account avatar', listed.error.message)
  } else if (listed.data.length > 0) {
    const cleaned = await avatars.remove(
      listed.data.map((object) => `${targetId}/${object.name}`),
    )
    if (cleaned.error) {
      console.warn('Could not remove a deleted account avatar', cleaned.error.message)
    }
  }

  try {
    return await deleteUserAccountData(targetId, audit)
  } catch (error) {
    throw accountWriteError(error, 'Could not delete every record for that account')
  }
}

function accountWriteError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback
  if (error instanceof UsageStoreMissing) return new SeatAdminError(message, 503)
  if (message === 'That account is not here.') return new SeatAdminError(message, 404)
  if (message.startsWith('That is an admin account')) return new SeatAdminError(message, 400)
  return new SeatAdminError(message, 500)
}

export async function deletePlatformAdmin(actorId: string, targetId: string, audit?: AdminAuditContext) {
  await guardAdminMutation(actorId, targetId)
  const service = createServiceClient()
  if (!service) {
    throw new SeatAdminError('SUPABASE_SERVICE_ROLE_KEY is not set.', 503)
  }
  const removed = await service.auth.admin.deleteUser(targetId)
  if (removed.error) throw new SeatAdminError(removed.error.message, 400)
  await deleteAdminRecord(targetId, audit)
}

export function adminPermissionRefusal(gate: Extract<AdminGate, { ok: true }>, minimum: 'operator' | 'owner') {
  if (minimum === 'owner' && gate.role !== 'Owner') return { error: 'Owner access required.', status: 403 as const }
  if (minimum === 'operator' && !canOperate(gate.role)) return { error: 'Operator access required.', status: 403 as const }
  return null
}

export async function platformAdminExists() {
  if (!createServiceClient()) {
    throw new SeatAdminError(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Supabase Auth hashes the password; this API does not store it.',
      503,
    )
  }
  try {
    // Any Admin profile — active or turned off — keeps the bootstrap window
    // shut. countAdmins() only counts active rows, so judging the open window
    // by it would silently reopen unauthenticated admin creation after a mass
    // deactivation (B2-5). The "last active must stay" invariant lives in
    // guardAdminMutation, where it belongs.
    return await hasAnyAdminProfile()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read admin roles'
    const status = error instanceof UsageStoreMissing ? 503 : 500
    throw new SeatAdminError(message, status)
  }
}

/**
 * Whether the bench trusts the bootstrap token presented on the open-branch
 * seat call. When ADMIN_BOOTSTRAP_TOKEN is unset the open branch stays open,
 * because some self-host flows seat the first admin through the UI with no
 * shell access to set env vars first. When it is set, the caller must echo it
 * in the x-bootstrap-token header; compared timing-safe so a scanner cannot
 * learn the token byte-by-byte.
 */
export function checkBootstrapToken(presented: string | null): boolean {
  const expected = process.env.ADMIN_BOOTSTRAP_TOKEN
  if (!expected) return true
  if (!presented) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function findAuthUserIdByEmail(email: string) {
  const service = createServiceClient()
  if (!service) return null
  return findUserIdByEmail(service, email)
}

export class SeatAdminError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function findUserIdByEmail(
  service: NonNullable<ReturnType<typeof createServiceClient>>,
  email: string,
) {
  for (let page = 1; page <= 10; page += 1) {
    const listed = await service.auth.admin.listUsers({ page, perPage: 200 })
    if (listed.error) throw new SeatAdminError(listed.error.message, 500)
    const found = listed.data.users.find((user) => user.email?.toLowerCase() === email)
    if (found) return found.id
    if (listed.data.users.length < 200) return null
  }
  return null
}

