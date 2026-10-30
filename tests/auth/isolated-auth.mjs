import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { mock } from 'node:test'
import { fileURLToPath } from 'node:url'
import { compileFunction } from 'node:vm'
import ts from 'typescript'

const nativeRequire = createRequire(import.meta.url)
const { NextResponse } = nativeRequire('next/server')
const root = fileURLToPath(new URL('../../', import.meta.url))
const sources = new Map([
  'lib/auth/service.ts',
  'lib/auth/current-user.ts',
  'lib/auth/hash.ts',
  'lib/auth/tokens.ts',
  'lib/auth/session.ts',
  'lib/auth/mail.ts',
  'lib/auth/http.ts',
  'app/api/auth/signup/route.ts',
  'app/api/auth/login/route.ts',
  'app/api/auth/resend/route.ts',
  'app/auth/verify/route.ts',
  'app/login/page.tsx',
].map((name) => [name.replace(/\.tsx?$/, ''), name]))
const compiled = new Map()

// Compile the real modules in memory. Imports fail closed: Prisma, Supabase,
// dotenv and the real mail transport are never loaded, even with local secrets.
export function createAuthHarness({ env = {}, transport } = {}) {
  const prisma = {
    user: {
      findFirst: mock.fn(async () => null),
      create: mock.fn(async ({ data }) => ({ ...data })),
    },
    authAccount: {
      findUnique: mock.fn(async () => null),
      create: mock.fn(async ({ data }) => ({ id: 'account-new', ...data })),
      update: mock.fn(async ({ where, data }) => ({ id: where.id, ...data })),
    },
    authSession: {
      findUnique: mock.fn(async () => null),
      create: mock.fn(async ({ data }) => ({ id: 'session-new', ...data })),
      delete: mock.fn(async () => ({})),
      deleteMany: mock.fn(async () => ({ count: 0 })),
    },
    verificationToken: {
      findUnique: mock.fn(async () => null),
      findFirst: mock.fn(async () => null),
      create: mock.fn(async ({ data }) => ({ id: 'verification-new', ...data })),
      deleteMany: mock.fn(async () => ({ count: 0 })),
      updateMany: mock.fn(async () => ({ count: 1 })),
    },
  }
  prisma.$transaction = mock.fn(async (work) => typeof work === 'function' ? work(prisma) : Promise.all(work))

  const supabase = {
    auth: {
      getUser: mock.fn(async () => ({ data: { user: null } })),
      signInWithPassword: mock.fn(async () => ({ data: { user: null }, error: null })),
    },
  }
  const createSupabase = mock.fn(async () => supabase)
  const usage = {
    ensureProfileRecord: mock.fn(async () => {}),
    readAccountStatus: mock.fn(async () => ({ active: true, role: 'User' })),
  }
  const mailTransport = mock.fn(transport ?? (async () => Response.json({ messageId: 'synthetic-message-id' }, { status: 201 })))
  const errors = mock.fn()
  const blockedFetch = mock.fn(() => { throw new Error('Live network is forbidden in auth regression tests') })
  let cookie
  const cookieRead = mock.fn((name) => cookie === undefined ? undefined : { name, value: cookie })
  const cookies = mock.fn(async () => ({ get: cookieRead }))
  const redirect = mock.fn((location) => { throw Object.assign(new Error('Isolated Next redirect'), { location }) })
  const LoginClient = () => null
  const safeProcess = { env: Object.freeze({
    NODE_ENV: 'test', BREVO_API_KEY: 'synthetic-api-key', MAIL_FROM_EMAIL: 'sender@example.test', ...env,
  }) }
  const isolatedFetch = (url, init) => url === 'https://api.brevo.com/v3/smtp/email'
    ? mailTransport(url, init) : blockedFetch(url, init)
  const safeGlobals = { crypto: webcrypto, process: safeProcess, fetch: isolatedFetch }
  const mocks = new Map([
    ['server-only', {}],
    ['next/server', { NextResponse }],
    ['next/headers', { cookies }],
    ['next/navigation', { redirect }],
    ['react/jsx-runtime', nativeRequire('react/jsx-runtime')],
    ['lib/auth/db', {
      getAuthPrisma: () => prisma,
      requireAuthPrisma: () => prisma,
      AuthStoreMissing: class AuthStoreMissing extends Error {},
    }],
    ['lib/supabase/server', { createClient: createSupabase }],
    ['lib/usage/store', usage],
    ['app/login/LoginClient', { __esModule: true, default: LoginClient }],
  ])
  const modules = new Map()

  function load(name) {
    const key = name.replace(/\\/g, '/').replace(/\.tsx?$/, '')
    if (mocks.has(key)) return mocks.get(key)
    if (modules.has(key)) return modules.get(key).exports
    const source = sources.get(key)
    if (!source) throw new Error(`Unexpected auth test dependency: ${name}`)
    const filename = resolve(root, source)
    if (!compiled.has(key)) {
      const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
        fileName: filename,
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      }).outputText
      compiled.set(key, compileFunction(code, [
        'exports', 'require', 'module', '__filename', '__dirname',
        'process', 'fetch', 'console', 'crypto', 'globalThis', 'global',
      ], { filename }))
    }
    const entry = { exports: {} }
    modules.set(key, entry)
    const isolatedRequire = (specifier) => {
      if (mocks.has(specifier)) return mocks.get(specifier)
      if (specifier === 'node:crypto' || specifier === 'node:util') return nativeRequire(specifier)
      if (specifier.startsWith('@/')) return load(specifier.slice(2))
      if (specifier.startsWith('.')) return load(relative(root, resolve(dirname(filename), specifier)))
      throw new Error(`Unexpected auth test dependency: ${specifier}`)
    }
    compiled.get(key)(entry.exports, isolatedRequire, entry, filename, dirname(filename),
      safeProcess, isolatedFetch, { error: errors }, webcrypto, safeGlobals, safeGlobals)
    return entry.exports
  }

  return {
    load, prisma, supabase, createSupabase, usage, mailTransport, errors,
    blockedFetch, cookieRead, redirect, LoginClient,
    setCookie: (value) => { cookie = value },
  }
}

export function authRequest(path, body, headers = {}) {
  return new Request(`https://auth.example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://auth.example.test', 'x-request-id': 'auth-test-request', ...headers },
    body: JSON.stringify(body),
  })
}
