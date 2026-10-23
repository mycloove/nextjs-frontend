import type { CreditSnapshot } from './credit-types.ts'

export const MAX_CREDITS = 1_000_000
export const CREDIT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class CreditError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code = 'invalid_credit_request', status = 400) {
    super(message)
    this.name = 'CreditError'
    this.code = code
    this.status = status
  }
}

export function creditInteger(value: unknown, label: string, min = 0, max = MAX_CREDITS): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new CreditError(`${label} must be a whole number between ${min} and ${max}.`)
  }
  return value
}

export function creditObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CreditError('A JSON object is required.')
  return value as Record<string, unknown>
}

export function creditReason(value: unknown): string {
  if (typeof value !== 'string') throw new CreditError('A reason is required.')
  const reason = value.trim()
  if (reason.length < 3 || reason.length > 240 || /[\u0000-\u001f\u007f]/.test(reason)) {
    throw new CreditError('Reason must contain 3 to 240 printable characters.')
  }
  return reason
}

export function creditPeriod(value: unknown): 24 | 168 {
  if (value !== 24 && value !== 168) throw new CreditError('The credit window must be 24 or 168 hours.')
  return value
}

export function validateCreditPolicy(value: unknown) {
  const row = creditObject(value)
  if (typeof row.enabled !== 'boolean') throw new CreditError('enabled must be true or false.')
  return {
    enabled: row.enabled,
    guestAllowance: creditInteger(row.guest_allowance, 'Guest allowance'),
    memberAllowance: creditInteger(row.member_allowance, 'Member allowance'),
    periodHours: creditPeriod(row.period_hours),
    expectedVersion: creditInteger(row.expected_version, 'Policy version', 1),
  }
}

export function calculateCreditBalance(input: {
  allowance: number
  entries: { amount: number; expiresAt: Date | null }[]
  reserved: number
  now: Date
}) {
  const active = input.entries.filter((entry) => !entry.expiresAt || entry.expiresAt > input.now)
  const used = active.reduce((sum, entry) => sum + Math.max(0, -entry.amount), 0)
  const adjustments = active.reduce((sum, entry) => sum + Math.max(0, entry.amount), 0)
  const futureReturns = active.filter((entry) => entry.amount < 0 && entry.expiresAt)
    .sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime())
  const next = futureReturns[0]?.expiresAt ?? null
  return {
    available: Math.max(0, input.allowance + adjustments - used - input.reserved),
    used,
    reserved: input.reserved,
    next_return_at: next?.toISOString() ?? null,
    next_return_amount: next ? futureReturns.filter((entry) => entry.expiresAt!.getTime() === next.getTime())
      .reduce((sum, entry) => sum - entry.amount, 0) : 0,
  }
}

export function canSpendCredits(available: number, cost: number): boolean {
  creditInteger(cost, 'Credit cost')
  return available >= cost
}

export function parseCreditSnapshot(value: unknown): CreditSnapshot {
  const row = creditObject(value)
  if (!['metered', 'unmetered', 'legacy', 'unavailable'].includes(String(row.mode)) ||
      (row.audience !== 'guest' && row.audience !== 'member') || typeof row.account_active !== 'boolean') {
    throw new CreditError('Invalid credit balance response.')
  }
  const metered = row.mode === 'metered'
  const numeric = (key: string) => metered ? creditInteger(row[key], key, 0, Number.MAX_SAFE_INTEGER) : null
  const prices: CreditSnapshot['prices'] = {}
  for (const [key, price] of Object.entries(creditObject(row.prices))) {
    const item = creditObject(price)
    if (!/^[a-z0-9-]{1,80}$/.test(key)) throw new CreditError('Invalid action price.')
    prices[key] = { cost: creditInteger(item.cost, 'Cost'), version: creditInteger(item.version, 'Price version', 1), enabled: item.enabled !== false }
  }
  if (typeof row.as_of !== 'string' || !Number.isFinite(Date.parse(row.as_of))) throw new CreditError('Invalid credit timestamp.')
  if (row.next_return_at !== null && (typeof row.next_return_at !== 'string' || !Number.isFinite(Date.parse(row.next_return_at)))) {
    throw new CreditError('Invalid credit return time.')
  }
  if (row.next_expiry_at !== undefined && row.next_expiry_at !== null &&
      (typeof row.next_expiry_at !== 'string' || !Number.isFinite(Date.parse(row.next_expiry_at)))) throw new CreditError('Invalid credit expiry time.')
  return {
    mode: row.mode as CreditSnapshot['mode'], audience: row.audience, account_active: row.account_active,
    available: numeric('available'), allowance: numeric('allowance'), used: numeric('used'), reserved: numeric('reserved'),
    period_hours: creditPeriod(row.period_hours), next_return_at: row.next_return_at as string | null,
    next_return_amount: creditInteger(row.next_return_amount, 'Return amount', 0, Number.MAX_SAFE_INTEGER),
    next_expiry_at: typeof row.next_expiry_at === 'string' ? row.next_expiry_at : null,
    next_expiry_amount: row.next_expiry_amount === undefined ? 0 : creditInteger(row.next_expiry_amount, 'Expiry amount', 0, Number.MAX_SAFE_INTEGER),
    revision: creditInteger(row.revision, 'Revision', 0, Number.MAX_SAFE_INTEGER), as_of: row.as_of, prices,
    message: typeof row.message === 'string' ? row.message : null,
  }
}
