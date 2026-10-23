import nextEnv from '@next/env'
import pg from 'pg'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

nextEnv.loadEnvConfig(process.cwd())
if (!process.env.DATABASE_URL) {
  console.log('Credit schema readiness: database configuration missing.')
  process.exitCode = 1
} else {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 })
  try {
    const result = await pool.query(`SELECT to_regclass('public.credit_policies') IS NOT NULL AS credits_ready,
      to_regclass('public.users') IS NOT NULL AS users_ready,
      to_regclass('public._prisma_migrations') IS NOT NULL AS migration_history`)
    console.log(JSON.stringify(result.rows[0]))
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL,
      ...(/supabase\.(co|com)/.test(process.env.DATABASE_URL) ? { ssl: { rejectUnauthorized: false } } : {}) }) })
    try {
      const policy = await db.creditPolicy.findUnique({ where: { id: 'default' }, select: { enabled: true } })
      console.log(JSON.stringify({ credit_client_ready: !!db.creditPolicy, credit_mode_enabled: policy?.enabled ?? false }))
    } finally { await db.$disconnect() }
  } catch (error) {
    console.error('Credit schema readiness check failed:', error.code ?? 'connection_error')
    process.exitCode = 1
  } finally { await pool.end() }
}
