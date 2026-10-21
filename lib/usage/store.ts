import { asAppRole } from '@/lib/supabase/roles'
import { PrismaPg } from '@prisma/adapter-pg'
import { Prisma, PrismaClient } from '@prisma/client'
import { periodHours, TOOL_CATALOG, usageWindow } from './catalog'
import type { ActivityRow, BenchGuest, BenchOverview, BenchUser, ToolControl, ToolUsageSummary, UsagePeriod } from './types'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
type Tx = Prisma.TransactionClient

export type AdminAuditContext = {
  actorId: string | null
  actorEmail: string | null
  requestId: string
}

export type AdminAuditRow = {
  id: string
  actor_id: string | null
  actor_email: string | null
  action: string
  target_type: string
  target_id: string | null
  request_id: string | null
  before: Prisma.JsonValue | null
  after: Prisma.JsonValue | null
  created_at: string
}

export type AdminFeatureUsage = {
  rows: { tool_id: string; successful_uses: number }[]
  total: number
  user: { id: string; email: string | null } | null
}

export class UsageStoreMissing extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageStoreMissing'
  }
}

/**
 * Matches a Postgres uuid literal. Only needed where a value typed by a human
 * reaches a uuid column directly: without this, a search for "ali" becomes
 * `WHERE id = 'ali'` and Postgres rejects the statement rather than matching
 * nothing, so one ordinary keystroke empties the list instead of filtering it.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function getPrisma() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) return null
  if (!globalForPrisma.prisma) {
    // Supabase's pooler cert is not in Node's trust store. pg verifies it
    // unless this is set, and then every query fails before it reaches SQL.
    const supabase = /supabase\.(co|com)/.test(connectionString)
    const adapter = new PrismaPg({
      connectionString,
      ...(supabase ? { ssl: { rejectUnauthorized: false } } : {}),
    })
    globalForPrisma.prisma = new PrismaClient({ adapter })
  }
  return globalForPrisma.prisma
}

function requirePrisma() {
  const prisma = getPrisma()
  if (!prisma) {
    throw new UsageStoreMissing('DATABASE_URL is not set. Apply the Prisma migration, then restart.')
  }
  return prisma
}

/** Analytics is deliberately separate from quota tallies and contains no payload data. */
export async function recordSuccessfulFeatureUsage(userId: string, toolId: string, eventId: string, fileName?: string | null) {
  const prisma = requirePrisma()
  const safeName = sanitizeFileName(fileName)
  try {
    await prisma.featureUsageEvent.create({
      data: { userId, toolId, eventId, ...(safeName ? { fileName: safeName } : {}) },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return
    rethrowStore(error)
  }
}

/**
 * Trims a client-supplied filename to something safe to persist and display:
 * path separators and control characters are stripped (so it can never be read
 * as a path), whitespace collapsed, and the result capped at 200 characters.
 * Returns null for empty/absent input, so text-only tools and legacy rows store
 * null rather than an empty string.
 */
export function sanitizeFileName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value
    .replace(/[\\/]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return null
  return cleaned.slice(0, 200)
}

/**
 * Success-only quota (D2/D3): beginToolQuota inserts the usage row up front so
 * the existing Serializable race-safety is preserved, and a conversion that
 * actually fails deletes that row again. The delete targets the row by
 * `request_id` — which is unique per usages row — never by anon/user id, so it
 * can never remove an unrelated earlier call (a guest's pre-login rows follow
 * them after claimAnonUsage, and those must survive). Empty id → no-op.
 *
 * Safe to call after the fact: deleteMany on an already-gone row is a zero-count
 * no-op, so a retry that already deduped never double-deletes.
 */
export async function releaseReservedUsage(requestId: string): Promise<boolean> {
  const id = requestId.trim()
  if (!id) return false
  const prisma = requirePrisma()
  try {
    const result = await prisma.usage.deleteMany({ where: { requestId: id } })
    return result.count > 0
  } catch (error) {
    rethrowStore(error)
  }
}

export async function readFeatureUsageAnalytics(input: { since: Date; userId?: string }): Promise<AdminFeatureUsage> {
  const prisma = requirePrisma()
  const where = {
    createdAt: { gte: input.since },
    ...(input.userId ? { userId: input.userId } : {}),
  }
  try {
    const [groups, user] = await Promise.all([
      prisma.featureUsageEvent.groupBy({
        by: ['toolId'],
        where,
        _count: { _all: true },
        orderBy: [{ _count: { toolId: 'desc' } }, { toolId: 'asc' }],
      }),
      input.userId
        ? prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, email: true } })
        : Promise.resolve(null),
    ])
    const rows = groups.map((row) => ({ tool_id: row.toolId, successful_uses: row._count._all }))
    return { rows, total: rows.reduce((sum, row) => sum + row.successful_uses, 0), user }
  } catch (error) {
    rethrowStore(error)
  }
}

export async function appendAdminAudit(
  tx: Tx,
  context: AdminAuditContext,
  event: {
    action: string
    targetType: string
    targetId?: string | null
    before?: Prisma.InputJsonValue
    after?: Prisma.InputJsonValue
  },
) {
  await tx.adminAuditLog.create({
    data: {
      actorId: context.actorId,
      actorEmail: context.actorEmail,
      requestId: context.requestId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId ?? null,
      ...(event.before === undefined ? {} : { before: event.before }),
      ...(event.after === undefined ? {} : { after: event.after }),
    },
  })
}

function rethrowStore(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2021' || error.code === 'P2022')) {
    throw new UsageStoreMissing('Usage tables are missing. Run npx prisma migrate deploy in nextjs-frontend.')
  }
  throw error
}

export type UsageRecord = {
  allowed: boolean
  used: number
  limit: number
  remaining: number
  resets_at: string | null
  authenticated: boolean
  message: string | null
  code: string | null
  tool_id: string | null
  tool_label: string | null
  period: UsagePeriod | null
  plan: null
}

/**
 * What `consumeToolUsage` returns: the snapshot plus whether THIS call actually
 * inserted a usages row. Only the real insert branch sets `reserved: true`; a
 * dedupe hit, an admin bypass, an unknown/disabled tool, a denial, and the
 * P2002 retry catch all leave it false. `quota.ts` uses it to decide whether a
 * failed conversion should release a slot — releasing on a non-insert would
 * delete a previously-successful row.
 *
 * `parseUsageSnapshot` ignores unknown fields, so the extra key is invisible to
 * every existing reader of the snapshot.
 */
export type ConsumedUsage = UsageRecord & { reserved: boolean }

function emptyRecord(authenticated: boolean, code: string, message: string | null, toolId: string | null): UsageRecord {
  return {
    allowed: code === 'ok' || code === 'unscoped' || code === 'admin_bypass',
    used: 0,
    limit: 0,
    remaining: 0,
    resets_at: null,
    authenticated,
    message,
    code,
    tool_id: toolId,
    tool_label: null,
    period: null,
    plan: null,
  }
}

function toToolControl(row: {
  toolId: string
  label: string
  href: string
  enabled: boolean
  guestLimit: number
  memberLimit: number
  period: UsagePeriod
  updatedAt: Date
}): ToolControl {
  return {
    tool_id: row.toolId,
    label: row.label,
    href: row.href,
    enabled: row.enabled,
    guest_limit: row.guestLimit,
    member_limit: row.memberLimit,
    period: row.period,
    // Row version for the desk's If-Match check (B2-2). Readers that do not
    // need it — availability, overview — simply ignore the field.
    updated_at: row.updatedAt.toISOString(),
  }
}

/**
 * Thrown when a bench write arrives against a stale row version. Carries the
 * fresh row so the desk can rebase without a second round trip: the route maps
 * it to 409 + { tool }, and the desk replaces server truth while keeping the
 * operator's typed draft intact.
 */
export class ToolVersionConflict extends Error {
  tool: ToolControl
  constructor(tool: ToolControl) {
    super('That instrument changed while you were editing. Your typed values are kept — compare with the fresh row, then save again.')
    this.name = 'ToolVersionConflict'
    this.tool = tool
  }
}

async function guardToolVersion(prisma: PrismaClient | Tx, toolId: string, expected?: string | null) {
  if (!expected) return
  const current = await prisma.tool.findUnique({ where: { toolId }, select: { updatedAt: true } })
  if (!current) throw new Error('That tool is not on the bench.')
  // Prisma @updatedAt has millisecond precision; string compare on the ISO
  // form is exact enough for a UI-level guard (a false conflict only costs a
  // re-save, never data loss).
  if (current.updatedAt.toISOString() !== expected) {
    const fresh = await prisma.tool.findUnique({ where: { toolId } })
    if (!fresh) throw new Error('That tool is not on the bench.')
    throw new ToolVersionConflict(toToolControl(fresh))
  }
}

export async function ensureProfileRecord(userId: string, email: string | null) {
  const prisma = requirePrisma()
  try {
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, email, role: 'User' },
      update: { email },
    })
  } catch (error) {
    rethrowStore(error)
  }
}

/**
 * Fills the owner row with whatever identity the OAuth provider returned, but
 * only where the row is still empty — a name the user typed or an avatar they
 * uploaded always wins over the provider copy. Called from `/auth/callback`
 * right after `ensureProfileRecord`, so a Google sign-in's photo and name show
 * up in the nav chip instead of a bare initial. Avatar values are accepted only
 * as absolute https URLs, matching what `/api/profile/avatar` records.
 */
export async function syncOAuthProfileIfNeeded(
  userId: string,
  email: string | null,
  name: string | null,
  avatarUrl: string | null,
) {
  const prisma = requirePrisma()
  try {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, avatarUrl: true },
    })
    if (!row) return
    const data: { name?: string; avatarUrl?: string } = {}
    if (!row.name && typeof name === 'string' && name.trim()) {
      data.name = name.trim().slice(0, 80)
    }
    if (!row.avatarUrl && typeof avatarUrl === 'string' && avatarUrl.startsWith('https://')) {
      data.avatarUrl = avatarUrl
    }
    if (Object.keys(data).length > 0) {
      await prisma.user.update({ where: { id: userId }, data })
    }
  } catch (error) {
    rethrowStore(error)
  }
}

export async function readStoredRole(userId: string) {
  const prisma = requirePrisma()
  try {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, active: true } })
    if (!row?.active) return 'User' as const
    return asAppRole(row.role)
  } catch (error) {
    rethrowStore(error)
  }
}

/** Missing row is a new sign-in and stays open. An explicit false is a withdrawn account. */
export async function readAccountStatus(userId: string) {
  const prisma = requirePrisma()
  try {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, active: true } })
    if (!row) return { active: true, role: 'User' as const }
    return { active: row.active, role: row.active ? asAppRole(row.role) : 'User' as const }
  } catch (error) {
    rethrowStore(error)
  }
}

/**
 * The signed-in owner's own profile. Reads only their row, so it can never leak
 * another account's email or name. Returns null if the row has not been created
 * yet (the route calls ensureProfileRecord first, so callers see a row).
 */
export async function readProfile(userId: string): Promise<ProfileRecord | null> {
  const prisma = requirePrisma()
  try {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, avatarUrl: true, role: true, active: true, createdAt: true },
    })
    if (!row) return null
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      avatar_url: row.avatarUrl,
      role: asAppRole(row.role),
      active: row.active,
      created_at: row.createdAt.toISOString(),
    }
  } catch (error) {
    rethrowStore(error)
  }
}

/**
 * Self-service display-name edit. Capped at 80 characters and stored null when
 * the input is blank, so "no name" is one state rather than two. The row must
 * already exist — the route calls ensureProfileRecord first — hence a plain
 * update rather than an upsert (which would need the email again).
 */
export async function updateProfileName(userId: string, name: string | null) {
  const prisma = requirePrisma()
  const trimmed = typeof name === 'string' ? name.trim().slice(0, 80) : ''
  try {
    const row = await prisma.user.update({
      where: { id: userId },
      data: { name: trimmed || null },
      select: { id: true, email: true, name: true, avatarUrl: true, role: true, active: true, createdAt: true },
    })
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      avatar_url: row.avatarUrl,
      role: asAppRole(row.role),
      active: row.active,
      created_at: row.createdAt.toISOString(),
    } satisfies ProfileRecord
  } catch (error) {
    rethrowStore(error)
  }
}

/**
 * Sets or clears the owner's avatar URL. The object itself is written and
 * removed by `/api/profile/avatar`; this only records the public URL the UI
 * reads. The row must already exist — the route calls ensureProfileRecord
 * first — hence a plain update rather than an upsert.
 */
export async function updateProfileAvatar(userId: string, avatarUrl: string | null) {
  const prisma = requirePrisma()
  try {
    const row = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: avatarUrl || null },
      select: { id: true, email: true, name: true, avatarUrl: true, role: true, active: true, createdAt: true },
    })
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      avatar_url: row.avatarUrl,
      role: asAppRole(row.role),
      active: row.active,
      created_at: row.createdAt.toISOString(),
    } satisfies ProfileRecord
  } catch (error) {
    rethrowStore(error)
  }
}

export type ProfileRecord = {
  id: string
  email: string | null
  name: string | null
  avatar_url: string | null
  role: string
  active: boolean
  created_at: string
}

export type ActivityPage = { rows: ActivityRow[]; total: number }

/**
 * Success-only activity for one owner, newest first. Scoped strictly to the
 * passed userId, so `/api/profile/activity` can only ever return the caller's
 * own rows; `file_name` is included here and nowhere the admin bench reads (D7).
 */
export async function listUserActivity(userId: string, input: { take: number; skip: number }): Promise<ActivityPage> {
  const prisma = requirePrisma()
  const take = Math.min(Math.max(Math.floor(input.take) || 0, 1), 50)
  const skip = Math.max(Math.floor(input.skip) || 0, 0)
  try {
    const [events, total] = await Promise.all([
      prisma.featureUsageEvent.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        skip,
        select: { toolId: true, fileName: true, createdAt: true },
      }),
      prisma.featureUsageEvent.count({ where: { userId } }),
    ])
    const labelFor = new Map(TOOL_CATALOG.map((tool) => [tool.tool_id, tool.label]))
    return {
      total,
      rows: events.map((row) => ({
        tool_id: row.toolId,
        tool_label: labelFor.get(row.toolId) ?? row.toolId,
        file_name: row.fileName,
        created_at: row.createdAt.toISOString(),
      })),
    }
  } catch (error) {
    rethrowStore(error)
  }
}

export type AdminRecord = {
  id: string
  email: string | null
  active: boolean
  role: string
  createdAt: Date
}

const BENCH_ROLES = ['Admin', 'Owner', 'Operator', 'Viewer']

export async function listAdminRecords(): Promise<AdminRecord[]> {
  const prisma = requirePrisma()
  try {
    return prisma.user.findMany({
      where: { role: { in: BENCH_ROLES } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, active: true, role: true, createdAt: true },
    })
  } catch (error) {
    rethrowStore(error)
  }
}

export async function countAdmins() {
  const prisma = requirePrisma()
  try {
    return prisma.user.count({ where: { role: { in: BENCH_ROLES }, active: true } })
  } catch (error) {
    rethrowStore(error)
  }
}

/**
 * Whether ANY Admin profile exists, active or turned off. The bootstrap
 * decision (lib/usage/admin.ts → platformAdminExists) must use this, never
 * countAdmins(): counting only active rows would silently reopen
 * unauthenticated admin creation after every admin is deactivated.
 */
export async function hasAnyAdminProfile() {
  const prisma = requirePrisma()
  try {
    return (await prisma.user.count({ where: { role: { in: BENCH_ROLES } } })) > 0
  } catch (error) {
    rethrowStore(error)
  }
}

export async function seatAdminProfile(userId: string, email: string, role: 'Owner' | 'Operator' | 'Viewer' = 'Owner', audit?: AdminAuditContext) {
  const prisma = requirePrisma()
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id: userId }, select: { role: true, active: true } })
      const row = await tx.user.upsert({
        where: { id: userId },
        create: { id: userId, email, role, active: true },
        update: { email, role, active: true },
        select: { id: true, email: true, active: true, role: true, createdAt: true },
      })
      if (audit) {
        await appendAdminAudit(tx, audit, {
          action: before ? 'admin.seat.restore' : audit.actorId ? 'admin.seat.create' : 'admin.bootstrap.create',
          targetType: 'admin-seat',
          targetId: row.id,
          ...(before ? { before: { role: before.role, active: before.active } } : {}),
          after: { role: row.role, active: row.active, email: row.email },
        })
      }
      return row
    })
  } catch (error) {
    rethrowStore(error)
  }
}

export async function setAdminActive(userId: string, active: boolean, audit?: AdminAuditContext) {
  const prisma = requirePrisma()
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id: userId }, select: { role: true, active: true } })
      if (!before || !BENCH_ROLES.includes(before.role)) throw new Error('That account is not an admin.')
      const row = await tx.user.update({
        where: { id: userId },
        data: { active },
        select: { id: true, email: true, active: true, role: true, createdAt: true },
      })
      if (audit) {
        await appendAdminAudit(tx, audit, {
          action: active ? 'admin.seat.activate' : 'admin.seat.deactivate',
          targetType: 'admin-seat',
          targetId: row.id,
          before: { role: before.role, active: before.active },
          after: { role: row.role, active: row.active },
        })
      }
      return row
    })
  } catch (error) {
    rethrowStore(error)
  }
}

/**
 * Turns a regular (non-bench) account on or off. Separate from setAdminActive,
 * which refuses anything that is not a bench role; this is the mirror and
 * refuses anything that IS a bench role, so an admin seat can only be changed
 * on the admins desk where the "last active owner" invariant is enforced.
 *
 * There is no analogous invariant for a regular account — turning one off
 * withdraws it (readAccountStatus demotes it to guest on the product path), and
 * it can be turned back on here. Audited like every other bench write.
 */
export async function setUserActive(userId: string, active: boolean, audit?: AdminAuditContext) {
  const prisma = requirePrisma()
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id: userId }, select: { role: true, active: true } })
      if (!before) throw new Error('That account is not here.')
      if (BENCH_ROLES.includes(before.role)) throw new Error('That is an admin account — manage it on the Admins desk.')
      const row = await tx.user.update({
        where: { id: userId },
        data: { active },
        select: { id: true, email: true, active: true, role: true, createdAt: true },
      })
      if (audit) {
        await appendAdminAudit(tx, audit, {
          action: active ? 'account.activate' : 'account.deactivate',
          targetType: 'account',
          targetId: row.id,
          before: { role: before.role, active: before.active },
          after: { active: row.active },
        })
      }
      return row
    })
  } catch (error) {
    if (error instanceof Error && (error.message === 'That account is not here.' || error.message === 'That is an admin account — manage it on the Admins desk.')) throw error
    rethrowStore(error)
  }
}

/**
 * Reads the stored row before a hard delete. This deliberately does not go
 * through readAccountStatus: that helper demotes an inactive bench account to
 * "User", which would let the users desk hard-delete an admin whose seat is
 * merely turned off. The stored role is what decides which desk owns it.
 */
export async function readAccountForDeletion(userId: string) {
  const prisma = requirePrisma()
  try {
    return await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, active: true },
    })
  } catch (error) {
    rethrowStore(error)
  }
}

export type AccountDeletionResult = {
  id: string
  email: string | null
  usage_rows: number
  feature_event_rows: number
  integration_rows: number
}

/**
 * Removes every product-side row owned by one regular account, in one
 * transaction, and writes the audit entry in that same transaction.
 *
 * `usages` has no foreign key to `users`, and `integration_connections` has
 * none either, so both have to be deleted explicitly — deleting only the
 * profile would leave recorded calls and a live GitHub binding behind. Repo
 * links cascade from their connection. `feature_usage_events` would cascade
 * from the profile delete, but is deleted explicitly so the result can report
 * how many rows went with the account.
 *
 * The bench audit log is intentionally kept: it records who deleted whom and
 * is the deployment's accountability trail, not the deleted person's data.
 */
export async function deleteUserAccountData(
  userId: string,
  audit?: AdminAuditContext,
): Promise<AccountDeletionResult> {
  const prisma = requirePrisma()
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id: userId },
        select: { email: true, role: true, active: true },
      })
      if (!before) throw new Error('That account is not here.')
      if (BENCH_ROLES.includes(before.role)) {
        throw new Error('That is an admin account — manage it on the Admins desk.')
      }

      const usage = await tx.usage.deleteMany({ where: { userId } })
      const events = await tx.featureUsageEvent.deleteMany({ where: { userId } })
      const integrations = await tx.integrationConnection.deleteMany({ where: { userId } })
      await tx.user.delete({ where: { id: userId } })

      if (audit) {
        await appendAdminAudit(tx, audit, {
          action: 'account.delete',
          targetType: 'account',
          targetId: userId,
          before: {
            email: before.email,
            role: before.role,
            active: before.active,
            usage_rows: usage.count,
            feature_event_rows: events.count,
            integration_rows: integrations.count,
          },
          after: { deleted: true },
        })
      }

      return {
        id: userId,
        email: before.email,
        usage_rows: usage.count,
        feature_event_rows: events.count,
        integration_rows: integrations.count,
      }
    })
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === 'That account is not here.' ||
        error.message === 'That is an admin account — manage it on the Admins desk.')
    ) {
      throw error
    }
    rethrowStore(error)
  }
}

export async function deleteAdminRecord(userId: string, audit?: AdminAuditContext) {
  const prisma = requirePrisma()
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id: userId }, select: { email: true, role: true, active: true } })
      if (!before || !BENCH_ROLES.includes(before.role)) throw new Error('That admin is not on the bench.')
      // B3-9: usages has no FK to users, so the profile delete alone would
      // orphan their recorded calls. They can never match again (a UUID is never
      // reused, so windowFilter's userId clause stops matching), but they would
      // inflate any per-person analytics later. Clear them first, same transaction.
      const usage = await tx.usage.deleteMany({ where: { userId } })
      await tx.user.delete({ where: { id: userId } })
      if (audit) {
        await appendAdminAudit(tx, audit, {
          action: 'admin.seat.delete',
          targetType: 'admin-seat',
          targetId: userId,
          before: { ...before, deleted_usage_rows: usage.count },
          after: { deleted: true },
        })
      }
    })
  } catch (error) {
    rethrowStore(error)
  }
}

async function ensureToolCatalog(prisma: PrismaClient) {
  await prisma.tool.createMany({
    data: TOOL_CATALOG.map((tool, index) => ({
      toolId: tool.tool_id,
      label: tool.label,
      href: tool.href,
      guestLimit: tool.guest_limit,
      memberLimit: tool.member_limit,
      period: 'day' as const,
      periodHours: 24,
      sortOrder: (index + 1) * 10,
      enabled: true,
      metadata: {},
      updatedAt: new Date(),
    })),
    skipDuplicates: true,
  })
}

export async function listToolControls(): Promise<ToolControl[]> {
  const prisma = requirePrisma()
  try {
    await ensureToolCatalog(prisma)
    const rows = await prisma.tool.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] })
    return rows.map(toToolControl)
  } catch (error) {
    rethrowStore(error)
  }
}

export async function updateToolControl(input: {
  toolId: string
  enabled: boolean
  guestLimit: number
  memberLimit: number
  period: UsagePeriod
  expectedUpdatedAt?: string | null
  audit?: AdminAuditContext
}) {
  const prisma = requirePrisma()
  try {
    return await prisma.$transaction(async (tx) => {
      await guardToolVersion(tx, input.toolId, input.expectedUpdatedAt ?? null)
      const before = await tx.tool.findUnique({ where: { toolId: input.toolId } })
      if (!before) throw new Error('That tool is not on the bench.')
      const row = await tx.tool.update({
        where: { toolId: input.toolId },
        data: {
          enabled: input.enabled,
          guestLimit: input.guestLimit,
          memberLimit: input.memberLimit,
          period: input.period,
          periodHours: periodHours(input.period),
        },
      })
      if (input.audit) {
        await appendAdminAudit(tx, input.audit, {
          action: 'tool.control.update',
          targetType: 'tool',
          targetId: row.toolId,
          before: { enabled: before.enabled, guest_limit: before.guestLimit, member_limit: before.memberLimit, period: before.period },
          after: { enabled: row.enabled, guest_limit: row.guestLimit, member_limit: row.memberLimit, period: row.period },
        })
      }
      return toToolControl(row)
    })
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new Error('That tool is not on the bench.')
    }
    rethrowStore(error)
  }
}

export async function resetToolUsage(toolId: string, userId: string | null, audit?: AdminAuditContext) {
  const prisma = requirePrisma()
  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const tool = await tx.tool.findUnique({ where: { toolId }, select: { toolId: true } })
      if (!tool) throw new Error('That tool is not on the bench.')
      const result = await tx.usage.deleteMany({ where: userId ? { toolId, userId } : { toolId } })
      if (audit) {
        await appendAdminAudit(tx, audit, {
          action: 'tool.usage.reset',
          targetType: 'tool',
          targetId: toolId,
          before: { scope: userId ? 'account' : 'all', user_id: userId },
          after: { deleted_rows: result.count },
        })
      }
      return result.count
    })
    try {
      await prisma.featureUsageEvent.deleteMany({ where: userId ? { toolId, userId } : { toolId } })
    } catch (error) {
      console.warn('Could not clear feature usage analytics', error instanceof Error ? error.message : error)
    }
    return deleted
  } catch (error) {
    if (error instanceof Error && error.message === 'That tool is not on the bench.') throw error
    rethrowStore(error)
  }
}

/**
 * Partial write for the bench. The bench has two independent writers for one
 * tool — the cap form and the on/off switch — and a full-object PUT makes the
 * later one silently revert the earlier one's unsaved edits. Sending only the
 * changed fields means the switch can no longer clobber a draft.
 */
export async function patchToolControl(
  toolId: string,
  fields: Partial<{
    enabled: boolean
    guestLimit: number
    memberLimit: number
    period: UsagePeriod
  }>,
  expectedUpdatedAt?: string | null,
  audit?: AdminAuditContext,
) {
  const prisma = requirePrisma()
  try {
    return await prisma.$transaction(async (tx) => {
      await guardToolVersion(tx, toolId, expectedUpdatedAt ?? null)
      const before = await tx.tool.findUnique({ where: { toolId } })
      if (!before) throw new Error('That tool is not on the bench.')
      const data: Record<string, unknown> = {}
      if (typeof fields.enabled === 'boolean') data.enabled = fields.enabled
      if (Number.isFinite(fields.guestLimit)) data.guestLimit = Math.floor(Number(fields.guestLimit))
      if (Number.isFinite(fields.memberLimit)) data.memberLimit = Math.floor(Number(fields.memberLimit))
      if (fields.period === 'day' || fields.period === 'week') {
        data.period = fields.period
        // periodHours is derived, never accepted from the client.
        data.periodHours = periodHours(fields.period)
      }
      if (!Object.keys(data).length) throw new Error('Nothing to save.')
      const row = await tx.tool.update({ where: { toolId }, data })
      if (audit) {
        await appendAdminAudit(tx, audit, {
          action: 'tool.control.update',
          targetType: 'tool',
          targetId: toolId,
          before: { enabled: before.enabled, guest_limit: before.guestLimit, member_limit: before.memberLimit, period: before.period },
          after: { enabled: row.enabled, guest_limit: row.guestLimit, member_limit: row.memberLimit, period: row.period },
        })
      }
      return toToolControl(row)
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Nothing to save.') throw error
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new Error('That tool is not on the bench.')
    }
    rethrowStore(error)
  }
}

/**
 * Recorded calls per tool, split guest / signed-in, over both possible rolling
 * windows (24h and 7d) so the caller can pick per tool without a second round
 * trip. All five queries are served by the existing [toolId, createdAt] and
 * [userId, createdAt] indexes; this runs on the bench only, never on a tool
 * conversion.
 */
export async function toolUsageSummaries(): Promise<Record<string, ToolUsageSummary>> {
  const prisma = requirePrisma()
  const day = new Date(Date.now() - 24 * 3_600_000)
  const week = new Date(Date.now() - 7 * 24 * 3_600_000)
  const guest = { userId: null }
  const member = { userId: { not: null } }
  try {
    const [guest24, member24, guest7d, member7d, oldest] = await Promise.all([
      prisma.usage.groupBy({ by: ['toolId'], where: { createdAt: { gt: day }, ...guest }, _count: { _all: true } }),
      prisma.usage.groupBy({ by: ['toolId'], where: { createdAt: { gt: day }, ...member }, _count: { _all: true } }),
      prisma.usage.groupBy({ by: ['toolId'], where: { createdAt: { gt: week }, ...guest }, _count: { _all: true } }),
      prisma.usage.groupBy({ by: ['toolId'], where: { createdAt: { gt: week }, ...member }, _count: { _all: true } }),
      prisma.usage.groupBy({ by: ['toolId'], where: { createdAt: { gt: day } }, _min: { createdAt: true } }),
    ])
    const out: Record<string, ToolUsageSummary> = {}
    const bump = (rows: typeof guest24, key: 'guest_used_24h' | 'member_used_24h' | 'guest_used_7d' | 'member_used_7d') => {
      for (const row of rows) {
        const entry = (out[row.toolId] ??= {
          tool_id: row.toolId,
          guest_used_24h: 0,
          member_used_24h: 0,
          guest_used_7d: 0,
          member_used_7d: 0,
          oldest_24h: null,
        })
        entry[key] = row._count._all
      }
    }
    bump(guest24, 'guest_used_24h')
    bump(member24, 'member_used_24h')
    bump(guest7d, 'guest_used_7d')
    bump(member7d, 'member_used_7d')
    for (const row of oldest) {
      const entry = (out[row.toolId] ??= {
        tool_id: row.toolId,
        guest_used_24h: 0,
        member_used_24h: 0,
        guest_used_7d: 0,
        member_used_7d: 0,
        oldest_24h: null,
      })
      entry.oldest_24h = row._min.createdAt?.toISOString() ?? null
    }
    return out
  } catch (error) {
    rethrowStore(error)
  }
}

/** Counts for one page of accounts. The ids arrive already limited by the page. */
async function countsForUsers(userIds: string[]) {
  const prisma = requirePrisma()
  if (!userIds.length) return { day: new Map<string, number>(), total: new Map<string, number>() }
  const day = new Date(Date.now() - 24 * 3_600_000)
  const [recent, all] = await Promise.all([
    prisma.usage.groupBy({ by: ['userId'], where: { userId: { in: userIds }, createdAt: { gt: day } }, _count: { _all: true } }),
    prisma.usage.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _count: { _all: true } }),
  ])
  const dayMap = new Map<string, number>()
  const totalMap = new Map<string, number>()
  for (const row of recent) if (row.userId) dayMap.set(row.userId, row._count._all)
  for (const row of all) if (row.userId) totalMap.set(row.userId, row._count._all)
  return { day: dayMap, total: totalMap }
}

export type BenchUserPage = { rows: BenchUser[]; total: number }

/**
 * Accounts for the bench users desk. Paginated from the first query — this table
 * grows with every signed-in conversion, and the admins list already showed what
 * an unbounded findMany does to a page.
 */
export async function listBenchUsers(input: {
  query: string
  take: number
  skip: number
}): Promise<BenchUserPage> {
  const prisma = requirePrisma()
  const term = input.query.trim()
  const where = term
    ? {
        // Admins are shown here too; the bench needs one list, not two. `id` is a
        // UUID column, and Postgres rejects a non-UUID literal with
        // "invalid input syntax for type uuid" — which would take the whole page
        // down over a half-typed word. The id clause is therefore only added when
        // the term actually looks like one, so a name search still returns its
        // email matches instead of failing outright. Same shape as the pattern in
        // app/api/admin/users/route.ts, which guards the write side.
        OR: [
          { email: { contains: term, mode: 'insensitive' as const } },
          ...(UUID_PATTERN.test(term) ? [{ id: term }] : []),
        ],
      }
    : {}
  try {
    const [found, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: input.take,
        skip: input.skip,
        select: { id: true, email: true, role: true, active: true, createdAt: true },
      }),
      prisma.user.count({ where }),
    ])
    const counts = await countsForUsers(found.map((row) => row.id))
    return {
      total,
      rows: found.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        active: row.active,
        created_at: row.createdAt.toISOString(),
        calls_24h: counts.day.get(row.id) ?? 0,
        calls_total: counts.total.get(row.id) ?? 0,
      })),
    }
  } catch (error) {
    rethrowStore(error)
  }
}

export type BenchGuestPage = { rows: BenchGuest[]; total: number }

/**
 * Guest traffic has no account, so it can only be counted. `anon_id` is the
 * cookie value, so an operator can identify a browser by handing that number to
 * the person who reported a problem.
 */
export async function listBenchGuests(input: { take: number; skip: number }): Promise<BenchGuestPage> {
  const prisma = requirePrisma()
  const day = new Date(Date.now() - 24 * 3_600_000)
  try {
    const [total, recent, all] = await Promise.all([
      prisma.usage.groupBy({ by: ['anonId'], where: { userId: null }, _count: { _all: true } }),
      prisma.usage.groupBy({ by: ['anonId'], where: { userId: null, createdAt: { gt: day } }, _count: { _all: true } }),
      prisma.usage.groupBy({ by: ['anonId'], where: { userId: null }, _count: { _all: true }, orderBy: { _count: { anonId: 'desc' } } }),
    ])
    const dayMap = new Map<string, number>()
    const totalMap = new Map<string, number>()
    for (const row of recent) dayMap.set(row.anonId, row._count._all)
    for (const row of total) totalMap.set(row.anonId, row._count._all)
    const sorted = [...all].sort((a, b) => (b._count._all - a._count._all) || a.anonId.localeCompare(b.anonId))
    return {
      total: sorted.length,
      rows: sorted.slice(input.skip, input.skip + input.take).map((row) => ({
        anon_id: row.anonId,
        calls_24h: dayMap.get(row.anonId) ?? 0,
        calls_total: row._count._all,
      })),
    }
  } catch (error) {
    rethrowStore(error)
  }
}

/** Clears every recorded call for one person, on every tool. */
export async function clearPersonUsage(input: { userId?: string; anonId?: string }, audit?: AdminAuditContext) {
  const prisma = requirePrisma()
  try {
    const deleted = await prisma.$transaction(async (tx) => {
      let deleted = 0
      let targetType = ''
      let targetId = ''
      if (input.userId) {
        const row = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } })
        if (!row) throw new Error('That account is not here.')
        const result = await tx.usage.deleteMany({ where: { userId: input.userId } })
        deleted = result.count
        targetType = 'account'
        targetId = input.userId
      } else if (input.anonId) {
        const result = await tx.usage.deleteMany({ where: { anonId: input.anonId } })
        deleted = result.count
        targetType = 'browser'
        targetId = input.anonId
      } else {
        throw new Error('Nobody was chosen.')
      }
      if (audit) {
        await appendAdminAudit(tx, audit, {
          action: 'usage.person.clear',
          targetType,
          targetId,
          after: { deleted_rows: deleted },
        })
      }
      return deleted
    })
    if (input.userId) {
      try {
        await prisma.featureUsageEvent.deleteMany({ where: { userId: input.userId } })
      } catch (error) {
        console.warn('Could not clear feature usage analytics', error instanceof Error ? error.message : error)
      }
    }
    return deleted
  } catch (error) {
    if (error instanceof Error && (error.message === 'That account is not here.' || error.message === 'Nobody was chosen.')) throw error
    rethrowStore(error)
  }
}

export async function listAdminAudit(input: { take: number; skip: number; action?: string }) {
  const prisma = requirePrisma()
  const where = input.action ? { action: input.action } : undefined
  try {
    const [rows, total] = await Promise.all([
      prisma.adminAuditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: input.take,
        skip: input.skip,
      }),
      prisma.adminAuditLog.count({ where }),
    ])
    const data: AdminAuditRow[] = rows.map((row) => ({
      id: row.id,
      actor_id: row.actorId,
      actor_email: row.actorEmail,
      action: row.action,
      target_type: row.targetType,
      target_id: row.targetId,
      request_id: row.requestId,
      before: row.before,
      after: row.after,
      created_at: row.createdAt.toISOString(),
    }))
    return { rows: data, total }
  } catch (error) {
    rethrowStore(error)
  }
}

/**
 * Deletes recorded calls older than the retention window. Rows older than the
 * longest quota window (7 days) can never affect a decision — the tally
 * filters createdAt > now - periodHours — so they are pure storage cost and
 * eventually slow count() on the hot path (B3-8). Never call this from the
 * request path: wire it to a daily cron (e.g. a scheduled job hitting an
 * ops-only endpoint that calls this with an olderThanDays of 8). Keep the
 * default at 8 days so a full weekly window plus a margin always survives.
 */
export async function pruneOldUsage(olderThanDays = 8) {
  const prisma = requirePrisma()
  const days = Number.isFinite(olderThanDays) && olderThanDays > 0 ? Math.floor(olderThanDays) : 8
  try {
    const cutoff = new Date(Date.now() - days * 24 * 3_600_000)
    const result = await prisma.usage.deleteMany({ where: { createdAt: { lt: cutoff } } })
    return result.count
  } catch (error) {
    rethrowStore(error)
  }
}

export async function benchOverview(): Promise<BenchOverview> {
  const prisma = requirePrisma()
  const day = new Date(Date.now() - 24 * 3_600_000)
  const week = new Date(Date.now() - 7 * 24 * 3_600_000)
  try {
    const [tools, admins, accounts, accountsActive, adminsActive, callsDay, callsWeek, guestsDay] = await Promise.all([
      prisma.tool.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] }),
      prisma.user.count({ where: { role: { in: BENCH_ROLES } } }),
      prisma.user.count(),
      prisma.user.count({ where: { active: true } }),
      // An inactive admin cannot sign in, so this is the number that can act.
      prisma.user.count({ where: { role: { in: BENCH_ROLES }, active: true } }),
      prisma.usage.count({ where: { createdAt: { gt: day } } }),
      prisma.usage.count({ where: { createdAt: { gt: week } } }),
      // `anon_id` is non-null on every row, so distinct browsers can only be
      // asked for by filtering to the rows that have no account behind them.
      prisma.usage.groupBy({ by: ['anonId'], where: { createdAt: { gt: day }, userId: null }, _count: { _all: true } }),
    ])
    const controls = tools.map(toToolControl)
    return {
      tools_total: controls.length,
      tools_open: controls.filter((row) => row.enabled).length,
      admins_total: admins,
      admins_active: adminsActive,
      accounts_total: accounts,
      accounts_active: accountsActive,
      guests_24h: guestsDay.length,
      calls_24h: callsDay,
      calls_7d: callsWeek,
      withdrawn: controls.filter((row) => !row.enabled),
    }
  } catch (error) {
    rethrowStore(error)
  }
}

export async function claimAnonUsage(userId: string, anonId: string) {
  const prisma = requirePrisma()
  try {
    const result = await prisma.usage.updateMany({
      where: { anonId, userId: null },
      data: { userId },
    })
    return result.count
  } catch (error) {
    rethrowStore(error)
  }
}

function windowFilter(userId: string | null, anonId: string, toolId: string, hours: number) {
  const since = new Date(Date.now() - hours * 3_600_000)
  return {
    toolId,
    createdAt: { gt: since },
    ...(userId
      ? { OR: [{ userId }, { userId: null, anonId }] }
      : { anonId }),
  }
}

async function tally(tx: Tx, userId: string | null, anonId: string, toolId: string, hours: number) {
  const where = windowFilter(userId, anonId, toolId, hours)
  const [used, oldest] = await Promise.all([
    tx.usage.count({ where }),
    tx.usage.findFirst({ where, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
  ])
  return { used, oldest: oldest?.createdAt ?? null }
}

function recordForTool(
  tool: { toolId: string; label: string; guestLimit: number; memberLimit: number; period: UsagePeriod; periodHours: number },
  userId: string | null,
  used: number,
  oldest: Date | null,
  now: Date,
): UsageRecord {
  const limit = userId ? tool.memberLimit : tool.guestLimit
  const view = usageWindow(used, limit, oldest, tool.periodHours, now)
  return {
    allowed: view.allowed,
    used,
    limit,
    remaining: view.remaining,
    resets_at: view.resets_at,
    authenticated: userId !== null,
    message: null,
    code: view.allowed ? 'ok' : 'quota_exceeded',
    tool_id: tool.toolId,
    tool_label: tool.label,
    period: tool.period,
    plan: null,
  }
}

async function snapshotIn(
  tx: Tx,
  anonId: string,
  userId: string | null,
  toolId: string | null,
  now: Date,
): Promise<UsageRecord> {
  if (!toolId) {
    return emptyRecord(userId !== null, 'unscoped', null, null)
  }
  const tool = await tx.tool.findUnique({ where: { toolId } })
  if (!tool) {
    return {
      ...emptyRecord(userId !== null, 'tool_unknown', 'This tool is not on the bench.', toolId),
      allowed: false,
    }
  }
  if (!tool.enabled) {
    return {
      ...emptyRecord(userId !== null, 'tool_disabled', `${tool.label} is turned off.`, tool.toolId),
      allowed: false,
      tool_label: tool.label,
    }
  }
  const tallyRow = await tally(tx, userId, anonId, tool.toolId, tool.periodHours)
  return recordForTool(tool, userId, tallyRow.used, tallyRow.oldest, now)
}

export async function readToolSnapshot(anonId: string, userId: string | null, toolId: string | null) {
  const prisma = requirePrisma()
  try {
    await ensureToolCatalog(prisma)
    if (userId) await claimAnonUsage(userId, anonId)
    return await prisma.$transaction((tx: Tx) => snapshotIn(tx, anonId, userId, toolId, new Date()))
  } catch (error) {
    rethrowStore(error)
  }
}

function exceededMessage(limit: number, period: UsagePeriod, label: string, signedIn: boolean) {
  if (!signedIn) {
    return `You have used all ${limit} ${period} calls on ${label}. Sign in for the signed-in cap — calls already made still count.`
  }
  return `You have used all ${limit} ${period} calls on ${label}.`
}

export async function consumeToolUsage(input: {
  anonId: string
  userId: string | null
  toolId: string
  requestId: string
  isAdmin: boolean
}): Promise<ConsumedUsage> {
  const prisma = requirePrisma()
  const now = new Date()
  const requestId = input.requestId.trim() || null
  try {
    await ensureToolCatalog(prisma)
    if (input.userId) await claimAnonUsage(input.userId, input.anonId)

    return await runSerializable(prisma, async (tx) => {
      if (requestId) {
        const existing = await tx.usage.findUnique({ where: { requestId }, select: { toolId: true } })
        if (existing) {
          // Dedupe hit on a retried request id: no row was created by this call,
          // so it must never be released.
          const prior = await snapshotIn(tx, input.anonId, input.userId, existing.toolId, now)
          if (prior.code === 'tool_disabled' || prior.code === 'tool_unknown') return { ...prior, reserved: false }
          return { ...prior, allowed: true, code: 'ok', message: null, reserved: false }
        }
      }

      const tool = await tx.tool.findUnique({ where: { toolId: input.toolId } })
      if (!tool) {
        return {
          ...emptyRecord(input.userId !== null, 'tool_unknown', 'This tool is not on the bench.', input.toolId),
          allowed: false,
          reserved: false,
        }
      }
      if (!tool.enabled) {
        return {
          ...emptyRecord(input.userId !== null, 'tool_disabled', `${tool.label} is turned off.`, tool.toolId),
          allowed: false,
          tool_label: tool.label,
          reserved: false,
        }
      }

      const current = await tally(tx, input.userId, input.anonId, tool.toolId, tool.periodHours)
      const view = recordForTool(tool, input.userId, current.used, current.oldest, now)

      if (input.isAdmin) {
        return { ...view, allowed: true, code: 'admin_bypass', message: null, reserved: false }
      }

      if (!view.allowed) {
        return {
          ...view,
          allowed: false,
          code: 'quota_exceeded',
          message: exceededMessage(view.limit, tool.period, tool.label, input.userId !== null),
          reserved: false,
        }
      }

      await tx.usage.create({
        data: {
          anonId: input.anonId,
          userId: input.userId,
          toolId: tool.toolId,
          requestId,
        },
      })
      const after = await tally(tx, input.userId, input.anonId, tool.toolId, tool.periodHours)
      // The one branch that created a row: this call holds a reserved slot that
      // a failed conversion must release.
      return { ...recordForTool(tool, input.userId, after.used, after.oldest, now), reserved: true }
    })
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && requestId) {
      // requestId collided on retry — the row already exists, so this is a
      // dedupe hit, not an insert. Releasing it would delete the earlier call.
      const prior = await readToolSnapshot(input.anonId, input.userId, input.toolId)
      if (prior.code === 'tool_disabled' || prior.code === 'tool_unknown') return { ...prior, reserved: false }
      return { ...prior, allowed: true, code: 'ok', message: null, reserved: false }
    }
    rethrowStore(error)
  }
}

async function runSerializable<T>(prisma: PrismaClient, fn: (tx: Tx) => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (error: unknown) {
      const retry = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
      if (!retry || attempt === 2) throw error
    }
  }
  throw new Error('Usage update did not settle.')
}

/**
 * What the bench's own persistence is doing, for the settings desk.
 *
 * Three separate questions, because they fail for three separate reasons: the
 * environment variable is missing (nothing was configured), the connection is
 * refused (the variable is wrong or the database is down), or the tables are
 * absent (the migration was never applied). Collapsing them into one "error"
 * is what makes the bench unactionable when it breaks.
 */
export type StoreStatus = {
  env_set: boolean
  reachable: boolean
  tables_present: boolean
  message: string
  counts: { users: number; tools: number; usages: number }
}

export async function benchStoreStatus(): Promise<StoreStatus> {
  const base: StoreStatus = {
    env_set: Boolean(process.env.DATABASE_URL),
    reachable: false,
    tables_present: false,
    message: '',
    counts: { users: 0, tools: 0, usages: 0 },
  }
  if (!base.env_set) {
    return {
      ...base,
      message: 'DATABASE_URL is not set. The quota store is not connected and every tool runs uncapped.',
    }
  }
  const prisma = requirePrisma()
  try {
    const [users, tools, usages] = await Promise.all([
      prisma.user.count(),
      prisma.tool.count(),
      prisma.usage.count(),
    ])
    return { ...base, reachable: true, tables_present: true, counts: { users, tools, usages } }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2021' || error.code === 'P2022')) {
      return {
        ...base,
        reachable: true,
        tables_present: false,
        message: 'The tables are missing. Run npx prisma migrate deploy in nextjs-frontend, then restart.',
      }
    }
    return { ...base, message: 'The database refused the connection. Check DATABASE_URL and whether it is running.' }
  }
}
