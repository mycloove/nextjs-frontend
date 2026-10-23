export type CreditMode = 'metered' | 'unmetered' | 'legacy' | 'unavailable'

export type CreditSnapshot = {
  mode: CreditMode
  audience: 'guest' | 'member'
  account_active: boolean
  available: number | null
  allowance: number | null
  used: number | null
  reserved: number | null
  period_hours: 24 | 168
  next_return_at: string | null
  next_return_amount: number
  next_expiry_at?: string | null
  next_expiry_amount?: number
  revision: number
  as_of: string
  prices: Record<string, { cost: number; version: number; enabled: boolean }>
  message: string | null
}

export type CreditPolicyView = {
  enabled: boolean
  guest_allowance: number
  member_allowance: number
  period_hours: 24 | 168
  version: number
  activated_at: string | null
  prices: { tool_id: string; label: string; cost: number; version: number; enabled: boolean }[]
}

export type CreditBalanceState = {
  snapshot: CreditSnapshot | null
  status: 'loading' | 'ready' | 'error'
  refreshing: boolean
  refresh: () => void
}
