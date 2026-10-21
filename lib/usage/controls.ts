import { TOOL_CATALOG } from './catalog'
import { parseToolControl } from './parse'
import {
  benchOverview as readBenchOverview,
  benchStoreStatus,
  clearPersonUsage as clearPersonUsageRows,
  listBenchGuests as readBenchGuests,
  listBenchUsers as readBenchUsers,
  listAdminAudit as readBenchAudit,
  readFeatureUsageAnalytics as readFeatureUsageRows,
  listToolControls,
  patchToolControl as patchToolControlRow,
  resetToolUsage,
  toolUsageSummaries,
  ToolVersionConflict,
  updateToolControl,
  UsageStoreMissing,
} from './store'
import type { AdminAuditContext, AdminAuditRow, AdminFeatureUsage } from './store'
import type { BenchGuest, BenchOverview, BenchUser, ToolControl, ToolUsageSummary, UsagePeriod } from './types'

const GROUP_BY_TOOL: Record<string, string> = Object.fromEntries(
  TOOL_CATALOG.map((tool) => [tool.tool_id, tool.group]),
)

export async function listToolAvailability() {
  const rows = await listToolControls()
  return rows.map((row) => parseToolControl(row)).filter((row): row is ToolControl => Boolean(row))
}

export async function listAdminToolControls() {
  return listToolAvailability()
}

/**
 * Adds the catalog group to the bench's copy of the tool list. The group has
 * never been stored on the tools row — it only exists in TOOL_CATALOG — so it is
 * joined here rather than written, which keeps every existing row and the
 * availability endpoint untouched.
 */
export async function listAdminToolControlsGrouped(): Promise<ToolControl[]> {
  const rows = await listAdminToolControls()
  return rows.map((row) => ({ ...row, group: GROUP_BY_TOOL[row.tool_id] ?? 'Other' }))
}

export { ToolVersionConflict }

export async function updateAdminToolControl(input: {
  tool_id: string
  enabled: boolean
  guest_limit: number
  member_limit: number
  period: UsagePeriod
  expected_updated_at?: string | null
  audit?: AdminAuditContext
}) {
  const tool = await updateToolControl({
    toolId: input.tool_id,
    enabled: input.enabled,
    guestLimit: input.guest_limit,
    memberLimit: input.member_limit,
    period: input.period,
    expectedUpdatedAt: input.expected_updated_at ?? null,
    audit: input.audit,
  })
  const parsed = parseToolControl(tool)
  if (!parsed) throw new Error('Tool update did not return a row.')
  return { ...parsed, group: GROUP_BY_TOOL[parsed.tool_id] ?? 'Other' }
}

/**
 * Writes only the fields the operator actually changed. This is what stops the
 * on/off switch from reverting unsaved cap edits on the same card, which a
 * full-object write made certain.
 */
export async function patchAdminToolControl(
  toolId: string,
  fields: Partial<{
    enabled: boolean
    guest_limit: number
    member_limit: number
    period: UsagePeriod
  }>,
  expectedUpdatedAt?: string | null,
  audit?: AdminAuditContext,
) {
  const tool = await patchToolControlRow(toolId, {
    enabled: fields.enabled,
    guestLimit: fields.guest_limit,
    memberLimit: fields.member_limit,
    period: fields.period,
  }, expectedUpdatedAt ?? null, audit)
  const parsed = parseToolControl(tool)
  if (!parsed) throw new Error('Tool update did not return a row.')
  return { ...parsed, group: GROUP_BY_TOOL[parsed.tool_id] ?? 'Other' }
}

export async function resetAdminToolUsage(toolId: string, userId: string | null, audit?: AdminAuditContext) {
  return resetToolUsage(toolId, userId, audit)
}

/** Missing tables or an unset DATABASE_URL leaves every tool open. The API still enforces once Prisma is migrated. */
export async function isToolOpen(toolId: string) {
  try {
    const tools = await listToolAvailability()
    if (!tools.length) return true
    const tool = tools.find((row) => row.tool_id === toolId)
    return tool ? tool.enabled : true
  } catch {
    return true
  }
}

/*
 * The three readers below are bench display data, not enforcement. A store that
 * is missing or unreachable must degrade them to an empty read rather than take
 * a page down, for the same reason beginToolQuota fails open: a quota system is
 * never allowed to be the reason the product stops working. The failure is
 * reported separately so the page can say the numbers are missing instead of
 * showing zeros as if they were real.
 */
export type BenchRead<T> = { data: T; degraded: boolean; message: string }

async function benchRead<T>(fallback: T, run: () => Promise<T>): Promise<BenchRead<T>> {
  try {
    return { data: await run(), degraded: false, message: '' }
  } catch (error) {
    const message =
      error instanceof UsageStoreMissing
        ? error.message
        : error instanceof Error
          ? error.message
          : 'The bench could not read its store.'
    return { data: fallback, degraded: true, message }
  }
}

export async function readAdminUsageSummaries(): Promise<BenchRead<Record<string, ToolUsageSummary>>> {
  return benchRead<Record<string, ToolUsageSummary>>({}, toolUsageSummaries)
}

export async function readAdminOverview(): Promise<BenchRead<BenchOverview>> {
  return benchRead<BenchOverview>(
    {
      tools_total: 0,
      tools_open: 0,
      admins_total: 0,
      admins_active: 0,
      accounts_total: 0,
      accounts_active: 0,
      guests_24h: 0,
      calls_24h: 0,
      calls_7d: 0,
      withdrawn: [],
    },
    readBenchOverview,
  )
}

export async function readAdminUsers(input: { query: string; take: number; skip: number }): Promise<BenchRead<{ rows: BenchUser[]; total: number }>> {
  return benchRead({ rows: [], total: 0 }, () => readBenchUsers(input))
}

export async function readAdminGuests(input: { take: number; skip: number }): Promise<BenchRead<{ rows: BenchGuest[]; total: number }>> {
  return benchRead({ rows: [], total: 0 }, () => readBenchGuests(input))
}

/** Clearing someone's recorded calls is a real write, so it throws rather than degrading. */
export async function clearAdminPersonUsage(input: { userId?: string; anonId?: string }, audit?: AdminAuditContext) {
  return clearPersonUsageRows(input, audit)
}

export async function readAdminAuditEvents(input: { take: number; skip: number; action?: string }): Promise<BenchRead<{ rows: AdminAuditRow[]; total: number }>> {
  return benchRead({ rows: [], total: 0 }, () => readBenchAudit(input))
}

export async function readAdminFeatureUsageAnalytics(input: { since: Date; userId?: string }): Promise<BenchRead<AdminFeatureUsage>> {
  return benchRead({ rows: [], total: 0, user: null }, () => readFeatureUsageRows(input))
}

/**
 * Settings-desk read. Unlike the display readers above this one already
 * distinguishes "no variable", "unreachable" and "no tables" itself, because a
 * single degraded flag would tell an operator their bench is broken without
 * saying which of the three it is.
 */
export async function readAdminStoreStatus() {
  try {
    return await benchStoreStatus()
  } catch (error) {
    return {
      env_set: Boolean(process.env.DATABASE_URL),
      reachable: false,
      tables_present: false,
      message: error instanceof Error ? error.message : 'The store could not be inspected.',
      counts: { users: 0, tools: 0, usages: 0 },
    }
  }
}
