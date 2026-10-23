import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { before, after, test } from 'node:test'
import { startPrismaDevServer } from '@prisma/dev'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { adjustCredits, claimGuestCredits, finishCreditOperation, readCreditBalance, readCreditPolicy, reserveCredits, saveCreditOverride, saveCreditPolicy, saveCreditPrice, type CreditActor } from './credit-store.ts'

// A disposable PostgreSQL-compatible instance. Never connect tests to DATABASE_URL or
// the product's Supabase project; closing the stateless server discards this DB.
let server: Awaited<ReturnType<typeof startPrismaDevServer>>
let db: PrismaClient
let adminId: string
const hash = 'a'.repeat(64)

before(async () => {
  server = await startPrismaDevServer({ name: `credit-tests-${process.pid}` })
  // Prisma's embedded dev database serializes connections. A single pg pool
  // connection avoids a proxy SET TRANSACTION race without weakening the
  // account's Serializable transaction semantics in the production service.
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: server.database.prismaORMConnectionString, max: 1 }) })
  await db.$executeRawUnsafe('CREATE TABLE users (id UUID PRIMARY KEY, email TEXT, name TEXT, avatar_url TEXT, role TEXT NOT NULL DEFAULT \'User\', active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)')
  await db.$executeRawUnsafe('CREATE TYPE usage_period AS ENUM (\'day\', \'week\')')
  await db.$executeRawUnsafe('CREATE TABLE tools (tool_id TEXT PRIMARY KEY, label TEXT NOT NULL, href TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true, guest_limit INT NOT NULL, member_limit INT NOT NULL, period usage_period NOT NULL DEFAULT \'day\', period_hours INT NOT NULL DEFAULT 24, sort_order INT NOT NULL DEFAULT 0, metadata JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)')
  await db.$executeRawUnsafe('CREATE TABLE admin_audit_logs (id UUID PRIMARY KEY, actor_id UUID, actor_email TEXT, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, request_id TEXT, before JSONB, after JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)')
  const sql = await readFile(new URL('../../prisma/migrations/20261022160000_credit_accounts/migration.sql', import.meta.url), 'utf8')
  for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement)
  adminId = randomUUID()
  await db.user.create({ data: { id: adminId, role: 'Owner' } })
  for (const toolId of ['pdf-to-word', 'merge-pdf', 'image-editor']) {
    await db.tool.create({ data: { toolId, label: toolId, href: `/${toolId}`, guestLimit: 5, memberLimit: 10, metadata: {} } })
  }
  await db.creditPolicy.update({ where: { id: 'default' }, data: { enabled: true, activatedAt: new Date() } })
}, { timeout: 120_000 })

after(async () => { if (db) await db.$disconnect(); if (server) await server.close() })

function guest(): CreditActor { return { anonId: randomUUID(), userId: null, active: true, unmetered: false } }
async function member(): Promise<CreditActor> {
  const id = randomUUID()
  await db.user.create({ data: { id } })
  return { anonId: randomUUID(), userId: id, active: true, unmetered: false }
}
function audit() { return { actorId: adminId, actorEmail: null, requestId: randomUUID() } }
function spend(actor: CreditActor, toolId = 'pdf-to-word', key = randomUUID(), fingerprint = hash) {
  return reserveCredits(db, { actor, toolId, actionKey: `POST:/api/${toolId}`, operationKey: key, fingerprint })
}

test('the last credit is reserved, settled once, and the next action is denied', async () => {
  const actor = await member()
  await saveCreditOverride(db, actor, { allowance: 1, expiresAt: null, expectedRevision: 0, reason: 'Test one credit' }, audit())
  const hold = await spend(actor)
  assert.equal(hold.snapshot.available, 0)
  assert.equal(hold.snapshot.reserved, 1)
  assert.equal(await finishCreditOperation(db, hold.operationId!, true), true)
  assert.equal(await finishCreditOperation(db, hold.operationId!, true), false)
  const balance = await readCreditBalance(db, actor)
  assert.equal(balance.used, 1)
  assert.equal(balance.reserved, 0)
  assert.equal(balance.next_return_amount, 1)
  await assert.rejects(spend(actor), { code: 'insufficient_credits' })
})

test('different tools cannot overspend one shared account concurrently', async () => {
  const actor = await member()
  await saveCreditOverride(db, actor, { allowance: 1, expiresAt: null, expectedRevision: 0, reason: 'Concurrency test' }, audit())
  const outcomes = await Promise.allSettled([spend(actor, 'pdf-to-word'), spend(actor, 'merge-pdf')])
  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1)
  assert.equal(outcomes.filter((item) => item.status === 'rejected').length, 1)
  assert.equal((await readCreditBalance(db, actor)).reserved, 1)
})

test('failed or refused work releases the reservation without permanent spend', async () => {
  const actor = guest()
  const hold = await spend(actor)
  await finishCreditOperation(db, hold.operationId!, false)
  const balance = await readCreditBalance(db, actor)
  assert.equal(balance.available, 20)
  assert.equal(balance.used, 0)
  assert.equal(balance.reserved, 0)
})

test('idempotency is actor/action scoped and never authorizes free repeated work', async () => {
  const actor = guest()
  const key = randomUUID()
  const hold = await spend(actor, 'pdf-to-word', key)
  await assert.rejects(spend(actor, 'pdf-to-word', key), { code: 'credit_operation_exists' })
  await assert.rejects(spend(actor, 'pdf-to-word', key, 'b'.repeat(64)), { code: 'credit_operation_conflict' })
  const other = await spend(guest(), 'pdf-to-word', key)
  assert.ok(other.operationId)
  await finishCreditOperation(db, hold.operationId!, true)
  await assert.rejects(spend(actor, 'pdf-to-word', key), { code: 'credit_operation_exists' })
})

test('guest claim preserves spend and pending settlement, and cannot be repeated for a fresh allowance', async () => {
  const source = guest()
  const completed = await spend(source)
  await finishCreditOperation(db, completed.operationId!, true)
  const pending = await spend(source)
  const user = await member()
  const actor = { ...user, anonId: source.anonId }
  await claimGuestCredits(db, actor)
  await finishCreditOperation(db, pending.operationId!, true)
  await claimGuestCredits(db, actor)
  const balance = await readCreditBalance(db, actor)
  assert.equal(balance.available, 98)
  assert.equal(balance.used, 2)
  assert.equal((await readCreditBalance(db, source)).available, 18)
  const memberOnly = await spend(actor)
  await finishCreditOperation(db, memberOnly.operationId!, true)
  assert.equal((await readCreditBalance(db, source)).available, 18, 'guest view must not reveal unrelated signed-in spending')
  const anotherMember = await member()
  await claimGuestCredits(db, { ...anotherMember, anonId: source.anonId })
  assert.equal((await readCreditBalance(db, actor)).used, 3)
})

test('admin adjustment retries are exactly once and ledger history is retained', async () => {
  const actor = guest()
  const operationId = randomUUID()
  const context = audit()
  await adjustCredits(db, actor, 5, 'Support credit grant', operationId, context)
  await adjustCredits(db, actor, 5, 'Support credit grant', operationId, context)
  assert.equal((await readCreditBalance(db, actor)).available, 25)
  await assert.rejects(adjustCredits(db, actor, 6, 'Support credit grant', operationId, context), { code: 'credit_operation_conflict' })
})

test('captured cost survives a price edit and a stale displayed quote cannot authorize a new debit', async () => {
  const actor = guest()
  const hold = await spend(actor)
  const view = await readCreditPolicy(db)
  const price = view.prices.find((row) => row.tool_id === 'pdf-to-word')!
  await saveCreditPrice(db, 'pdf-to-word', 2, price.version, audit())
  await finishCreditOperation(db, hold.operationId!, true)
  assert.equal((await readCreditBalance(db, actor)).used, 1)
  await assert.rejects(reserveCredits(db, { actor, toolId: 'pdf-to-word', actionKey: 'POST:/api/pdf-to-word', operationKey: randomUUID(), fingerprint: hash, quotedCost: 1, quotedVersion: price.version }), { code: 'credit_quote_changed' })
})

test('zero-cost browser actions are free, disabled tools refuse even unmetered admins', async () => {
  const hold = await spend(guest(), 'image-editor')
  assert.equal(hold.cost, 0)
  await finishCreditOperation(db, hold.operationId!, true)
  await db.tool.update({ where: { toolId: 'merge-pdf' }, data: { enabled: false } })
  await assert.rejects(spend({ anonId: randomUUID(), userId: adminId, active: true, unmetered: true }, 'merge-pdf'), { code: 'tool_disabled' })
  await db.tool.update({ where: { toolId: 'merge-pdf' }, data: { enabled: true } })
})

test('an activated pool cannot silently roll back and grant legacy allowance again', async () => {
  const view = await readCreditPolicy(db)
  await assert.rejects(saveCreditPolicy(db, { enabled: false, guestAllowance: 20, memberAllowance: 100, periodHours: 24, expectedVersion: view.version }, audit()), { code: 'credit_cutover_required' })
})
