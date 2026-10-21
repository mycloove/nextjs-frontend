export type UsagePeriod = 'day' | 'week'
export type UsageAudience = 'guest' | 'authenticated'

export type UsagePlan = {
  id: string
  slug: string
  name: string
  audience: UsageAudience
  period: UsagePeriod
  period_hours: number
  call_limit: number
  enabled: boolean
  is_default: boolean
}

export type ToolControl = {
  tool_id: string
  label: string
  href: string
  enabled: boolean
  guest_limit: number
  member_limit: number
  period: UsagePeriod
  /**
   * Catalog grouping. Optional and read-only: it comes from TOOL_CATALOG at the
   * edge (see lib/usage/catalog.ts), never from the tools table, so existing
   * rows and every existing reader of this type are unaffected.
   */
  group?: string
  /**
   * Row version for optimistic concurrency. The tools table already carries
   * updatedAt (@updatedAt); the desk sends it back as expected_updated_at and
   * the store refuses a write whose base moved (409 + fresh row). Optional so
   * older readers — availability, overview — keep working untouched.
   */
  updated_at?: string
}

/**
 * Recorded calls per tool, counted across everyone (every guest and every
 * signed-in account) rather than for any one person. The bench shows it as
 * "how loaded is this instrument", never as a single person's allowance —
 * `usageWindow` remains the only definition of what one caller has left.
 */
export type ToolUsageSummary = {
  tool_id: string
  guest_used_24h: number
  member_used_24h: number
  guest_used_7d: number
  member_used_7d: number
  /** Oldest counted call, used to show when the rolling window clears. */
  oldest_24h: string | null
  /**
   * Pre-formatted by the server. The desks are client components, so they are
   * rendered on both runtimes; anything reading the clock here would produce two
   * different answers in two different timezones and trip hydration.
   */
  clears_label?: string | null
}

/** One row of the bench users desk. Counters are per person. */
export type BenchUser = {
  id: string
  email: string | null
  role: string
  active: boolean
  created_at: string
  calls_24h: number
  calls_total: number
}

/**
 * Unattributed guest traffic. Guests exist only as an anon id inside `usages`,
 * so they can be counted and cleared but never listed as named accounts.
 */
export type BenchGuest = {
  anon_id: string
  calls_24h: number
  calls_total: number
}

export type BenchOverview = {
  tools_total: number
  tools_open: number
  admins_total: number
  admins_active: number
  accounts_total: number
  accounts_active: number
  guests_24h: number
  calls_24h: number
  calls_7d: number
  withdrawn: ToolControl[]
}

/**
 * One signed-in user's own profile, read by their own session only. `name` is
 * the editable product-side display name; `email` always comes from Supabase
 * Auth. `role`/`active` mirror the account status the rest of the app enforces.
 * `avatar_url` is the public Storage URL of the owner's photo, or null.
 */
export type Profile = {
  id: string
  email: string | null
  name: string | null
  avatar_url: string | null
  role: string
  active: boolean
  created_at: string
}

/**
 * One success-only activity row, owner-scoped. `file_name` is the processed
 * file's name (null for text-only tools and legacy rows); it is never returned
 * to the admin bench (D7).
 */
export type ActivityRow = {
  tool_id: string
  tool_label: string
  file_name: string | null
  created_at: string
}

export type UsageSnapshot = {
  allowed: boolean
  used: number
  limit: number
  remaining: number
  resets_at: string | null
  authenticated: boolean
  is_admin: boolean
  message: string | null
  code: string | null
  tool_id: string | null
  tool_label: string | null
  period: UsagePeriod | null
  plan: UsagePlan | null
}

export type UsageRpcPayload = {
  allowed?: unknown
  used?: unknown
  limit?: unknown
  remaining?: unknown
  resets_at?: unknown
  authenticated?: unknown
  message?: unknown
  code?: unknown
  tool_id?: unknown
  tool_label?: unknown
  period?: unknown
  plan?: unknown
}
