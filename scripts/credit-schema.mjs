import { spawnSync } from 'node:child_process'
import nextEnv from '@next/env'

// Use Next's .env.local precedence without copying a URL into a command or log.
// Prisma's default dotenv loader reads .env only; the app does not.
nextEnv.loadEnvConfig(process.cwd())
const action = process.argv[2] ?? 'status'
if (!['status', 'deploy'].includes(action)) throw new Error('Use status or deploy.')
if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) throw new Error('Database configuration is missing.')
const result = spawnSync(process.execPath, ['scripts/prisma.mjs', 'migrate', action], { stdio: 'inherit', env: process.env })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
