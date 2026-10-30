import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

/**
 * The auth tables' Prisma accessor (auth_accounts / auth_tokens / auth_sessions).
 *
 * Rationale for a second client instead of reusing `lib/usage/store`:
 * that store belongs to the usage module; auth is its own module and must not
 * reach a sibling's internals (CLAUDE.md §0.2). The pattern here is identical
 * to the upstream one, so the connection discipline stays consistent. Auth
 * traffic is tiny (one read per request), so the extra pool is not a load risk.
 */
const globalForAuth = globalThis as unknown as { authPrisma?: PrismaClient }

export class AuthStoreMissing extends Error {
  constructor() {
    super('DATABASE_URL is not set. Apply the custom-auth migration, then restart.')
    this.name = 'AuthStoreMissing'
  }
}

export function getAuthPrisma() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) return null
  // A dev server may outlive `prisma generate`. A pre-auth cached client has
  // no authAccount delegate; refresh it instead of failing every auth route
  // until the whole app process is manually restarted (same pattern as
  // lib/usage/store.ts, which learned this from the credit-table rollout).
  if (!globalForAuth.authPrisma || !Reflect.has(globalForAuth.authPrisma, 'authAccount')) {
    const previous = globalForAuth.authPrisma
    // Supabase's pooler cert is not in Node's trust store. pg verifies it
    // unless this is set, and then every query fails before it reaches SQL.
    const supabase = /supabase\.(co|com)/.test(connectionString)
    const adapter = new PrismaPg({
      connectionString,
      ...(supabase ? { ssl: { rejectUnauthorized: false } } : {}),
    })
    globalForAuth.authPrisma = new PrismaClient({ adapter })
    if (previous) void previous.$disconnect().catch(() => {})
  }
  return globalForAuth.authPrisma
}

export function requireAuthPrisma() {
  const prisma = getAuthPrisma()
  if (!prisma) throw new AuthStoreMissing()
  return prisma
}
