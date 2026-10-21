#!/usr/bin/env node
/**
 * Prisma CLI launcher.
 *
 * Why this file exists
 * --------------------
 * Prisma 7's CLI eagerly loads `@prisma/dev`, whose CommonJS bundle
 * (`node_modules/prisma/node_modules/@prisma/dev/dist/state.cjs`) calls
 * `require("zeptomatch")`. `zeptomatch` only ships an ESM build, so that
 * `require()` of an ES module only succeeds when Node's "require(esm)"
 * support is active:
 *
 *   - Node >= 20.19 and >= 22.12: active by default (this is why
 *     `prisma/package.json` declares `engines.node: "^20.19 || ^22.12 || >=24"`)
 *   - Node 20.17 - 20.18 and 22.0 - 22.11: available behind
 *     `--experimental-require-module`
 *
 * On Node 22.11 every `npx prisma ...` command therefore aborts with:
 *   Error [ERR_REQUIRE_ESM]: require() of ES Module .../zeptomatch/dist/index.js
 *   from .../@prisma/dev/dist/state.cjs not supported.
 *
 * This launcher executes the exact same locally installed Prisma CLI and adds
 * the flag only when the running Node version needs it, so `npm run dev`,
 * `npm run build`, `npm run typecheck` and the `db:*` scripts behave
 * identically on every Node version Prisma supports.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

const [major, minor] = process.versions.node.split('.').map(Number)
const requireEsmByDefault =
  major > 22 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19)

const execArgv = [...process.execArgv]
if (!requireEsmByDefault) {
  execArgv.push('--experimental-require-module')
}

const prismaPackageJson = require.resolve('prisma/package.json')
const prismaCli = path.join(path.dirname(prismaPackageJson), 'build', 'index.js')

const { error, status } = spawnSync(
  process.execPath,
  [...execArgv, prismaCli, ...process.argv.slice(2)],
  { stdio: 'inherit' },
)

if (error) {
  console.error(`[prisma] Unable to launch the Prisma CLI: ${error.message}`)
  process.exit(1)
}

process.exit(status ?? 1)
