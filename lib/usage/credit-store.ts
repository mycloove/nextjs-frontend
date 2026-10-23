import { Prisma, type PrismaClient } from '@prisma/client'
import { calculateCreditBalance, canSpendCredits, CreditError, creditInteger, creditPeriod, creditReason, CREDIT_UUID } from './credit-policy.ts'
import type { CreditPolicyView, CreditSnapshot } from './credit-types.ts'

type Tx = Prisma.TransactionClient
export type CreditActor = { anonId: string; userId: string | null; active: boolean; unmetered: boolean }
export type CreditAudit = { actorId: string; actorEmail: string | null; requestId: string }
const PRICE_DEFAULTS: Record<string, number> = { 'image-editor': 0 }

function ownerKey(actor: CreditActor) { return actor.userId ? `user:${actor.userId}` : `guest:${actor.anonId}` }

function validateActor(actor: CreditActor) {
  if (!CREDIT_UUID.test(actor.anonId) || (actor.userId !== null && !CREDIT_UUID.test(actor.userId))) {
    throw new CreditError('Invalid credit identity.')
  }
}

// Retry serialization conflicts, not arbitrary errors or a partially completed
// engine run. Every retry stays entirely inside this short database transaction.
export async function creditTransaction<T>(db: PrismaClient, run: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 15_000 })
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2034', 'P2002'].includes(error.code) || attempt >= 5) throw error
    }
  }
}

async function accountIn(tx: Tx, actor: CreditActor) {
  validateActor(actor)
  const account = await tx.creditAccount.upsert({
    where: { ownerKey: ownerKey(actor) }, create: { ownerKey: ownerKey(actor), userId: actor.userId }, update: {},
  })
  // A write on the account row serializes reservations across DIFFERENT tools.
  // Pending and settled snapshots can never independently authorize an overspend.
  return tx.creditAccount.update({ where: { id: account.id }, data: { revision: { increment: 1 } } })
}

async function policyIn(tx: Tx) {
  const policy = await tx.creditPolicy.findUnique({ where: { id: 'default' } })
  if (!policy) throw new CreditError('Credit policy has not been configured.', 'credits_unavailable', 503)
  return policy
}

async function priceMapIn(tx: Tx) {
  const [tools, prices] = await Promise.all([tx.tool.findMany({ select: { toolId: true } }), tx.creditPrice.findMany()])
  const byId = new Map(prices.map((price) => [price.toolId, price]))
  return Object.fromEntries(tools.map((tool) => {
    const price = byId.get(tool.toolId)
    return [tool.toolId, { cost: price?.cost ?? PRICE_DEFAULTS[tool.toolId] ?? 1, version: price?.version ?? 1, enabled: price?.enabled ?? true }]
  })) as CreditSnapshot['prices']
}

export async function creditSnapshotIn(tx: Tx, actor: CreditActor, accountId?: string, now = new Date()): Promise<CreditSnapshot> {
  const policy = await policyIn(tx)
  const prices = await priceMapIn(tx)
  const base = {
    audience: actor.userId ? 'member' as const : 'guest' as const,
    account_active: actor.active, period_hours: creditPeriod(policy.periodHours),
    next_return_at: null, next_return_amount: 0, revision: policy.version, as_of: now.toISOString(), prices, message: null,
  }
  if (!policy.enabled || actor.unmetered) {
    return { ...base, mode: policy.enabled ? 'unmetered' : 'legacy', available: null, allowance: null, used: null, reserved: null }
  }
  const account = accountId
    ? await tx.creditAccount.findUnique({ where: { id: accountId } })
    : await tx.creditAccount.findUnique({ where: { ownerKey: ownerKey(actor) } })
  const defaultAllowance = actor.userId ? policy.memberAllowance : policy.guestAllowance
  const overrideActive = actor.userId && account?.allowanceOverride !== null && account?.allowanceOverride !== undefined &&
    (!account.overrideExpiresAt || account.overrideExpiresAt > now)
  const allowance = overrideActive ? account!.allowanceOverride! : defaultAllowance
  if (!account) return { ...base, mode: 'metered', allowance, available: allowance, used: 0, reserved: 0 }
  const [entries, pending] = await Promise.all([
    tx.creditLedgerEntry.findMany({ where: { accountId: account.id, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { amount: true, expiresAt: true } }),
    tx.creditOperation.aggregate({ where: { state: 'reserved', ...(actor.userId ? { accountId: account.id } : {
      OR: [{ accountId: account.id }, { actorKey: ownerKey(actor) }],
    }) }, _sum: { cost: true } }),
  ])
  const grants = entries.filter((entry) => entry.amount > 0 && entry.expiresAt).sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime())
  const expiry = grants[0]?.expiresAt ?? null
  return { ...base, mode: 'metered', allowance, revision: policy.version + account.revision,
    next_expiry_at: expiry?.toISOString() ?? null,
    next_expiry_amount: expiry ? grants.filter((entry) => entry.expiresAt!.getTime() === expiry.getTime()).reduce((sum, entry) => sum + entry.amount, 0) : 0,
    ...calculateCreditBalance({ allowance, entries, reserved: pending._sum.cost ?? 0, now }) }
}

export async function readCreditBalance(db: PrismaClient, actor: CreditActor) {
  validateActor(actor)
  return creditTransaction(db, (tx) => creditSnapshotIn(tx, actor))
}

export type CreditReservation = { operationId: string | null; cost: number; snapshot: CreditSnapshot }

export async function reserveCredits(db: PrismaClient, input: {
  actor: CreditActor; toolId: string; actionKey: string; operationKey: string; fingerprint: string
  quotedCost?: number; quotedVersion?: number
}): Promise<CreditReservation> {
  validateActor(input.actor)
  if (!/^[a-z0-9-]{1,80}$/.test(input.toolId) || input.actionKey.length > 200 ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(input.operationKey) || !/^[a-f0-9]{64}$/.test(input.fingerprint)) {
    throw new CreditError('Invalid credit operation.')
  }
  return creditTransaction(db, async (tx) => {
    const tool = await tx.tool.findUnique({ where: { toolId: input.toolId } })
    if (!tool) throw new CreditError('This tool is not available.', 'tool_unknown', 403)
    if (!tool.enabled) throw new CreditError(`${tool.label} is turned off.`, 'tool_disabled', 403)
    const policy = await policyIn(tx)
    if (!policy.enabled) return { operationId: null, cost: 0, snapshot: await creditSnapshotIn(tx, input.actor) }
    const price = await tx.creditPrice.findUnique({ where: { toolId: input.toolId } })
    if (price?.enabled === false) return { operationId: null, cost: 0, snapshot: await creditSnapshotIn(tx, input.actor) }
    const account = await accountIn(tx, input.actor)
    const prior = await tx.creditOperation.findUnique({ where: { actorKey_actionKey_operationKey: {
      actorKey: ownerKey(input.actor), actionKey: input.actionKey, operationKey: input.operationKey,
    } } })
    if (prior) {
      // Never run the expensive work again with a free idempotency hit. We do
      // not persist document bytes in the ledger, so the caller must start a new
      // explicit operation rather than pretending a result can be replayed.
      if (prior.fingerprint !== input.fingerprint || prior.toolId !== input.toolId) {
        throw new CreditError('This operation key was already used for a different request.', 'credit_operation_conflict', 409)
      }
      throw new CreditError(prior.state === 'reserved' ? 'This operation is already processing.' : 'This operation has already finished. Start a new operation to run again.', 'credit_operation_exists', 409)
    }
    const cost = creditInteger(price?.cost ?? PRICE_DEFAULTS[input.toolId] ?? 1, 'Credit cost')
    const version = price?.version ?? 1
    if ((input.quotedCost !== undefined && input.quotedCost !== cost) || (input.quotedVersion !== undefined && input.quotedVersion !== version)) {
      throw new CreditError('The credit cost changed. Review the current price and try again.', 'credit_quote_changed', 409)
    }
    const snapshot = await creditSnapshotIn(tx, input.actor, account.id)
    if (!input.actor.unmetered && !canSpendCredits(snapshot.available ?? 0, cost)) {
      throw new CreditError(`This action needs ${cost} credit${cost === 1 ? '' : 's'}; ${snapshot.available ?? 0} available.`, 'insufficient_credits', 429)
    }
    const chargedCost = input.actor.unmetered ? 0 : cost
    const operation = await tx.creditOperation.create({ data: {
      accountId: account.id, actorKey: ownerKey(input.actor), toolId: input.toolId, actionKey: input.actionKey,
      operationKey: input.operationKey, fingerprint: input.fingerprint, cost: chargedCost,
      periodHours: policy.periodHours, priceVersion: version, policyVersion: policy.version,
    } })
    return { operationId: operation.id, cost: chargedCost, snapshot: await creditSnapshotIn(tx, input.actor, account.id) }
  })
}

export async function finishCreditOperation(db: PrismaClient, operationId: string, successful: boolean) {
  if (!CREDIT_UUID.test(operationId)) throw new CreditError('Invalid reservation id.')
  return creditTransaction(db, async (tx) => {
    const operation = await tx.creditOperation.findUnique({ where: { id: operationId } })
    if (!operation || operation.state !== 'reserved') return false
    await tx.creditAccount.update({ where: { id: operation.accountId }, data: { revision: { increment: 1 } } })
    const now = new Date()
    const expiresAt = new Date(now.getTime() + operation.periodHours * 3_600_000)
    const result = await tx.creditOperation.updateMany({ where: { id: operationId, state: 'reserved' }, data: {
      state: successful ? 'settled' : 'released', settledAt: successful ? now : null, expiresAt: successful ? expiresAt : null,
    } })
    if (!result.count) return false
    await tx.creditLedgerEntry.create({ data: {
      accountId: operation.accountId, operationId, kind: successful ? 'spend' : 'release',
      amount: successful ? -operation.cost : 0, expiresAt: successful ? expiresAt : null,
    } })
    if (successful && operation.actorKey.startsWith('guest:')) {
      const guest = await tx.creditAccount.findUnique({ where: { ownerKey: operation.actorKey } })
      if (guest && guest.id !== operation.accountId) {
        // Keep the originating browser's spent balance too. Logging out must
        // neither reveal the member's unrelated spend nor restore guest credit.
        await tx.creditAccount.update({ where: { id: guest.id }, data: { revision: { increment: 1 } } })
        await tx.creditLedgerEntry.create({ data: { accountId: guest.id, kind: 'claimed_spend', amount: -operation.cost,
          dedupeKey: `guest-origin:${operation.id}`, expiresAt } })
      }
    }
    return true
  })
}

export async function claimGuestCredits(db: PrismaClient, actor: CreditActor) {
  validateActor(actor)
  if (!actor.userId || !actor.active) throw new CreditError('Sign in to link guest credits.', 'sign_in_required', 401)
  return creditTransaction(db, async (tx) => {
    const guest = await tx.creditAccount.findUnique({ where: { ownerKey: `guest:${actor.anonId}` } })
    if (!guest) return creditSnapshotIn(tx, actor)
    const member = await accountIn(tx, actor)
    if (guest.claimedToId && guest.claimedToId !== member.id) return creditSnapshotIn(tx, actor, member.id)
    await tx.creditAccount.update({ where: { id: guest.id }, data: { claimedToId: member.id, revision: { increment: 1 } } })
    // Preserve costs and original expiry. A sign-in never adds guest remaining
    // to member allowance or revives expired spend. Moving pending operations
    // also makes their later settlement land in the claimed account.
    await tx.creditOperation.updateMany({ where: { accountId: guest.id, state: 'reserved' }, data: { accountId: member.id } })
    const entries = await tx.creditLedgerEntry.findMany({ where: { accountId: guest.id, kind: 'spend', amount: { lt: 0 },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } })
    for (const entry of entries) {
      const dedupeKey = `guest-claim:${entry.id}`
      await tx.creditLedgerEntry.upsert({ where: { dedupeKey }, create: { accountId: member.id, kind: 'guest_claim', amount: entry.amount,
        expiresAt: entry.expiresAt, dedupeKey, reason: 'Linked guest activity at sign-in.' }, update: {} })
    }
    return creditSnapshotIn(tx, actor, member.id)
  })
}

export async function readCreditPolicy(db: PrismaClient): Promise<CreditPolicyView> {
  return creditTransaction(db, async (tx) => {
    const [policy, tools, priceMap] = await Promise.all([policyIn(tx), tx.tool.findMany({ orderBy: { sortOrder: 'asc' }, select: { toolId: true, label: true } }), priceMapIn(tx)])
    return {
      enabled: policy.enabled, guest_allowance: policy.guestAllowance, member_allowance: policy.memberAllowance,
      period_hours: creditPeriod(policy.periodHours), version: policy.version, activated_at: policy.activatedAt?.toISOString() ?? null,
      prices: tools.map((tool) => ({ tool_id: tool.toolId, label: tool.label, ...priceMap[tool.toolId] })),
    }
  })
}

async function auditIn(tx: Tx, audit: CreditAudit, action: string, target: string, before: Prisma.InputJsonValue, after: Prisma.InputJsonValue) {
  await tx.adminAuditLog.create({ data: { actorId: audit.actorId, actorEmail: audit.actorEmail, requestId: audit.requestId, action, targetType: 'credits', targetId: target, before, after } })
}

export async function saveCreditPolicy(db: PrismaClient, input: { enabled: boolean; guestAllowance: number; memberAllowance: number; periodHours: 24 | 168; expectedVersion: number }, audit: CreditAudit) {
  await creditTransaction(db, async (tx) => {
    const before = await policyIn(tx)
    if (before.version !== input.expectedVersion) throw new CreditError('Credit policy changed. Reload before saving again.', 'credit_version_conflict', 409)
    // Disabling a live pool would grant fresh legacy allowances. Refuse until
    // operators deliberately reconcile both modes, rather than silently refund.
    if (before.enabled && !input.enabled) throw new CreditError('An active credit pool cannot be disabled without a reconciled migration.', 'credit_cutover_required', 409)
    const row = await tx.creditPolicy.update({ where: { id: 'default' }, data: {
      enabled: input.enabled, guestAllowance: input.guestAllowance, memberAllowance: input.memberAllowance, periodHours: input.periodHours,
      activatedAt: before.activatedAt ?? (input.enabled ? new Date() : null), version: { increment: 1 },
    } })
    await auditIn(tx, audit, input.enabled && !before.enabled ? 'credits.activate' : 'credits.policy.update', 'default',
      { enabled: before.enabled, guest: before.guestAllowance, member: before.memberAllowance, hours: before.periodHours },
      { enabled: row.enabled, guest: row.guestAllowance, member: row.memberAllowance, hours: row.periodHours })
  })
  return readCreditPolicy(db)
}

export async function saveCreditPrice(db: PrismaClient, toolId: string, cost: number, expectedVersion: number, audit: CreditAudit) {
  creditInteger(cost, 'Credit cost')
  await creditTransaction(db, async (tx) => {
    const tool = await tx.tool.findUnique({ where: { toolId } })
    if (!tool) throw new CreditError('Unknown tool.', 'tool_unknown', 404)
    const before = await tx.creditPrice.findUnique({ where: { toolId } })
    if ((before?.version ?? 1) !== expectedVersion) throw new CreditError('Credit price changed. Reload before saving.', 'credit_version_conflict', 409)
    await tx.creditPrice.upsert({ where: { toolId }, create: { toolId, cost, version: 2 }, update: { cost, version: { increment: 1 } } })
    await tx.creditPolicy.update({ where: { id: 'default' }, data: { version: { increment: 1 } } })
    await auditIn(tx, audit, 'credits.price.update', toolId, { cost: before?.cost ?? PRICE_DEFAULTS[toolId] ?? 1 }, { cost })
  })
  return readCreditPolicy(db)
}

export async function saveCreditFeature(db: PrismaClient, toolId: string, enabled: boolean, expectedVersion: number, audit: CreditAudit) {
  await creditTransaction(db, async (tx) => {
    const tool = await tx.tool.findUnique({ where: { toolId } })
    if (!tool) throw new CreditError('Unknown tool.', 'tool_unknown', 404)
    const before = await tx.creditPrice.findUnique({ where: { toolId } })
    if ((before?.version ?? 1) !== expectedVersion) throw new CreditError('Credit setting changed. Reload before saving.', 'credit_version_conflict', 409)
    await tx.creditPrice.upsert({ where: { toolId }, create: { toolId, enabled, version: 2 }, update: { enabled, version: { increment: 1 } } })
    await tx.creditPolicy.update({ where: { id: 'default' }, data: { version: { increment: 1 } } })
    await auditIn(tx, audit, enabled ? 'credits.feature.enable' : 'credits.feature.disable', toolId,
      { enabled: before?.enabled ?? true }, { enabled })
  })
  return readCreditPolicy(db)
}

export async function readAdminCreditAccount(db: PrismaClient, actor: CreditActor) {
  validateActor(actor)
  return creditTransaction(db, async (tx) => {
    const account = await tx.creditAccount.findUnique({ where: { ownerKey: ownerKey(actor) } })
    return { snapshot: await creditSnapshotIn(tx, actor), allowance_override: account?.allowanceOverride ?? null,
      override_expires_at: account?.overrideExpiresAt?.toISOString() ?? null, revision: account?.revision ?? 0 }
  })
}

export async function saveCreditOverride(db: PrismaClient, actor: CreditActor, input: { allowance: number | null; expiresAt: Date | null; expectedRevision: number; reason: string }, audit: CreditAudit) {
  if (!actor.userId) throw new CreditError('An allowance override requires an account.')
  if (input.allowance !== null) creditInteger(input.allowance, 'Allowance override')
  const reason = creditReason(input.reason)
  await creditTransaction(db, async (tx) => {
    const prior = await tx.creditAccount.findUnique({ where: { ownerKey: ownerKey(actor) } })
    if ((prior?.revision ?? 0) !== input.expectedRevision) throw new CreditError('The account balance changed. Reload before saving.', 'credit_version_conflict', 409)
    const account = await accountIn(tx, actor)
    await tx.creditAccount.update({ where: { id: account.id }, data: { allowanceOverride: input.allowance, overrideExpiresAt: input.allowance === null ? null : input.expiresAt } })
    await auditIn(tx, audit, 'credits.override.update', actor.userId!, { allowance: prior?.allowanceOverride ?? null },
      { allowance: input.allowance, expires_at: input.expiresAt?.toISOString() ?? null, reason })
  })
  return readAdminCreditAccount(db, actor)
}

export async function adjustCredits(db: PrismaClient, actor: CreditActor, amount: number, reasonInput: string, operationId: string, audit: CreditAudit) {
  creditInteger(amount, 'Adjustment', -1_000_000)
  if (!amount || !CREDIT_UUID.test(operationId)) throw new CreditError('A nonzero adjustment and UUID operation_id are required.')
  const reason = creditReason(reasonInput)
  await creditTransaction(db, async (tx) => {
    const key = `admin:${audit.actorId}:${operationId}`
    const prior = await tx.creditLedgerEntry.findUnique({ where: { dedupeKey: key }, include: { account: true } })
    if (prior) {
      if (prior.account.ownerKey !== ownerKey(actor) || prior.amount !== amount || prior.reason !== reason) {
        throw new CreditError('This adjustment key belongs to a different change.', 'credit_operation_conflict', 409)
      }
      return
    }
    const account = await accountIn(tx, actor)
    const policy = await policyIn(tx)
    const before = await creditSnapshotIn(tx, actor, account.id)
    await tx.creditLedgerEntry.create({ data: { accountId: account.id, kind: 'adjustment', amount, reason, actorId: audit.actorId,
      dedupeKey: key, expiresAt: new Date(Date.now() + policy.periodHours * 3_600_000) } })
    await auditIn(tx, audit, 'credits.adjustment', actor.userId ?? actor.anonId, { available: before.available }, { amount, reason })
  })
  return readAdminCreditAccount(db, actor)
}
