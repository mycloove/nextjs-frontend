import type { ToolControl, UsageAudience, UsagePeriod, UsagePlan, UsageRpcPayload, UsageSnapshot } from './types'

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asBoolean(value: unknown): boolean {
  return value === true
}

function asPeriod(value: unknown): UsagePeriod {
  return value === 'week' ? 'week' : 'day'
}

function asAudience(value: unknown): UsageAudience {
  return value === 'authenticated' ? 'authenticated' : 'guest'
}

export function parseUsagePlan(value: unknown): UsagePlan | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = asString(row.id)
  const slug = asString(row.slug)
  const name = asString(row.name)
  if (!id || !slug || !name) return null
  return {
    id,
    slug,
    name,
    audience: asAudience(row.audience),
    period: asPeriod(row.period),
    period_hours: asNumber(row.period_hours, row.period === 'week' ? 168 : 24),
    call_limit: asNumber(row.call_limit),
    enabled: row.enabled !== false,
    is_default: asBoolean(row.is_default),
  }
}

export function parseToolControl(value: unknown): ToolControl | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const toolId = asString(row.tool_id)
  const label = asString(row.label)
  const href = asString(row.href)
  if (!toolId || !label || !href) return null
  const updatedRaw = row.updated_at ?? row.updatedAt
  const updated_at =
    typeof updatedRaw === 'string' && updatedRaw
      ? updatedRaw
      : updatedRaw instanceof Date
        ? updatedRaw.toISOString()
        : undefined
  return {
    tool_id: toolId,
    label,
    href,
    enabled: row.enabled === true,
    guest_limit: asNumber(row.guest_limit),
    member_limit: asNumber(row.member_limit),
    period: asPeriod(row.period),
    ...(updated_at ? { updated_at } : {}),
  }
}

export function parseUsageSnapshot(payload: unknown, isAdmin = false): UsageSnapshot {
  const row = (payload && typeof payload === 'object' ? payload : {}) as UsageRpcPayload
  const used = asNumber(row.used)
  const limit = asNumber(row.limit)
  const remaining = typeof row.remaining === 'number' ? Math.max(0, row.remaining) : Math.max(0, limit - used)
  const resets = asString(row.resets_at)
  const period = row.period === 'week' || row.period === 'day' ? row.period : null
  return {
    allowed: row.allowed === true,
    used,
    limit,
    remaining,
    resets_at: resets,
    authenticated: asBoolean(row.authenticated),
    is_admin: isAdmin,
    message: asString(row.message),
    code: asString(row.code),
    tool_id: asString(row.tool_id),
    tool_label: asString(row.tool_label),
    period,
    plan: parseUsagePlan(row.plan),
  }
}

export function quotaExceededBody(snapshot: UsageSnapshot, requestId: string) {
  return {
    error: snapshot.message
      || (snapshot.authenticated
        ? `You have used all ${snapshot.limit} conversions on this plan.`
        : `You have used all ${snapshot.limit} free conversions. Sign in to keep going — used calls still count.`),
    code: 'quota_exceeded',
    used: snapshot.used,
    limit: snapshot.limit,
    remaining: snapshot.remaining,
    resets_at: snapshot.resets_at,
    plan: snapshot.plan?.name ?? null,
    login_href: snapshot.authenticated ? null : '/login',
    request_id: requestId,
  }
}
