import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authRequest, createAuthHarness } from './isolated-auth.mjs'

const rawCookie = 'a'.repeat(96)
const password = 'synthetic-admin-password'
const googleUser = { id: 'google-user', email: 'google@example.test' }
const adminRequest = () => new Request('https://auth.example.test/api/admin/admins', {
  headers: { 'x-request-id': 'admin-test-request' },
})

function customSession(role = 'Owner') {
  const h = createAuthHarness()
  const account = {
    id: 'custom-account', userId: 'custom-user', email: 'owner@example.test', emailVerified: true,
    user: { id: 'custom-user', email: 'owner@example.test', role, active: true },
  }
  const row = { account, expiresAt: new Date(Date.now() + 60_000) }
  const { asAppRole } = h.load('lib/supabase/roles.ts')
  h.setCookie(rawCookie)
  h.prisma.authSession.findUnique.mock.mockImplementation(async () => row)
  h.usage.readAccountStatus.mock.mockImplementation(async () => ({
    active: account.user.active,
    role: asAppRole(account.user.role),
  }))
  return { h, row }
}

async function loginRedirect(h, location) {
  await assert.rejects(h.load('app/login/page.tsx').default({ searchParams: Promise.resolve({}) }),
    (error) => error.location === location)
}

for (const role of ['Owner', 'Admin', 'Operator', 'Viewer']) {
  test(`custom-cookie-only ${role} agrees across login, admin layout/page and admin API`, async () => {
    const { h } = customSession(role)
    const expectedRole = role === 'Admin' ? 'Owner' : role
    await loginRedirect(h, '/admin')
    const admin = h.load('lib/usage/admin.ts')
    const gate = await admin.requireAdmin()
    assert.equal(gate.ok, true, 'a custom admin must not be redirected back to /login')
    assert.equal(gate.role, expectedRole)
    assert.equal(gate.user.id, 'custom-user')
    assert.equal(admin.adminEntryRedirect(gate), null)
    assert.equal(admin.adminPermissionRefusal(gate, 'owner')?.status ?? 200, expectedRole === 'Owner' ? 200 : 403)
    assert.equal(admin.adminPermissionRefusal(gate, 'operator')?.status ?? 200, expectedRole === 'Viewer' ? 403 : 200)

    const layout = await h.load('app/admin/layout.tsx').default({ children: 'bench content' })
    assert.equal(layout.props.children.type, h.AdminFrame)
    assert.equal(layout.props.children.props.email, 'owner@example.test')
    assert.equal(layout.props.children.props.role, expectedRole)
    if (expectedRole === 'Owner') {
      const page = await h.load('app/admin/page.tsx').default()
      assert.equal(page.type, h.PeopleDesk)
      assert.equal(page.props.currentUserId, 'custom-user')
    } else {
      await assert.rejects(h.load('app/admin/page.tsx').default(), (error) => error.location === '/admin/overview')
    }

    const response = await h.load('app/api/admin/admins/route.ts').GET(adminRequest())
    assert.equal(response.status, expectedRole === 'Owner' ? 200 : 403)
    assert.equal(response.headers.get('X-Request-Id'), 'admin-test-request')
    assert.equal(h.createSupabase.mock.callCount(), 0, 'custom sessions must not require a Supabase session')
    assert.equal(h.blockedFetch.mock.callCount(), 0)
  })
}

test('a real email/password login cookie can immediately enter admin without a Supabase cookie', async () => {
  const { h, row } = customSession()
  h.setCookie(undefined)
  const passwordHash = await h.load('lib/auth/hash.ts').hashPassword(password)
  h.prisma.authAccount.findUnique.mock.mockImplementation(async () => ({ ...row.account, passwordHash }))
  const response = await h.load('app/api/auth/login/route.ts').POST(authRequest('/api/auth/login', {
    email: row.account.email, password,
  }))
  assert.equal(response.status, 200)
  const cookie = response.cookies.get('smilepdf_auth')
  assert.ok(cookie?.httpOnly)
  const created = h.prisma.authSession.create.mock.calls[0].arguments[0].data
  h.prisma.authSession.findUnique.mock.mockImplementation(async ({ where }) =>
    where.tokenHash === created.tokenHash ? { ...row, expiresAt: created.expiresAt } : null)
  h.setCookie(cookie.value)

  const ownRole = await h.load('app/api/account/role/route.ts').GET()
  assert.deepEqual(await ownRole.json(), { role: 'Owner', active: true })
  await loginRedirect(h, '/admin')
  assert.equal((await h.load('lib/usage/admin.ts').requireAdmin()).ok, true)
  assert.equal((await h.load('app/api/admin/admins/route.ts').GET(adminRequest())).status, 200)
  assert.equal(h.createSupabase.mock.callCount(), 0)
})

for (const role of ['Owner', 'Admin', 'Operator', 'Viewer']) {
  test(`Google/legacy-only ${role} retains its admin role and write permissions`, async () => {
    const h = createAuthHarness()
    const expectedRole = role === 'Admin' ? 'Owner' : role
    h.supabase.auth.getUser.mock.mockImplementation(async () => ({ data: { user: googleUser } }))
    h.usage.readAccountStatus.mock.mockImplementation(async () => ({ active: true, role: expectedRole }))
    const admin = h.load('lib/usage/admin.ts')
    const gate = await admin.requireAdmin()
    assert.equal(gate.ok, true)
    assert.equal(gate.user.id, googleUser.id)
    assert.equal(gate.role, expectedRole)
    assert.equal(admin.adminPermissionRefusal(gate, 'owner')?.status ?? 200, expectedRole === 'Owner' ? 200 : 403)
    assert.equal(admin.adminPermissionRefusal(gate, 'operator')?.status ?? 200, expectedRole === 'Viewer' ? 403 : 200)
  })
}

for (const conflictingGoogle of [false, true]) {
  test(`custom User cannot enter admin${conflictingGoogle ? ' through a different Google admin session' : ''}`, async () => {
    const { h } = customSession('User')
    if (conflictingGoogle) h.supabase.auth.getUser.mock.mockImplementation(async () => ({ data: { user: googleUser } }))
    h.usage.readAccountStatus.mock.mockImplementation(async (userId) => ({ active: true, role: userId === googleUser.id ? 'Owner' : 'User' }))
    await loginRedirect(h, '/')
    const admin = h.load('lib/usage/admin.ts')
    const gate = await admin.requireAdmin()
    assert.equal(gate.ok, false)
    assert.equal(gate.status, 403)
    assert.equal(admin.adminEntryRedirect(gate), '/')
    assert.equal((await h.load('app/api/admin/admins/route.ts').GET(adminRequest())).status, 403)
    assert.equal(h.createSupabase.mock.callCount(), 0)
    assert.equal(h.usage.listAdminRecords.mock.callCount(), 0)
  })
}

for (const reason of ['guest', 'expired', 'unverified', 'disabled', 'unknown cookie', 'missing profile']) {
  test(`${reason} cannot enter admin and lands on a login form instead of another redirect`, async () => {
    const { h, row } = customSession()
    if (reason === 'guest') h.setCookie(undefined)
    if (reason === 'expired') row.expiresAt = new Date(0)
    if (reason === 'unverified') row.account.emailVerified = false
    if (reason === 'disabled') row.account.user.active = false
    if (reason === 'unknown cookie') h.prisma.authSession.findUnique.mock.mockImplementation(async () => null)
    if (reason === 'missing profile') row.account.user = null
    const admin = h.load('lib/usage/admin.ts')
    const gate = await admin.requireAdmin()
    assert.equal(gate.ok, false)
    assert.equal(admin.adminEntryRedirect(gate), '/login')
    const page = await h.load('app/login/page.tsx').default({ searchParams: Promise.resolve({}) })
    assert.equal(page.type, h.LoginClient)
    assert.equal(h.redirect.mock.callCount(), 0)
    assert.equal((await h.load('app/api/admin/admins/route.ts').GET(adminRequest())).status, 401)
    assert.equal(h.usage.listAdminRecords.mock.callCount(), 0)
  })
}

test('admin keeps the fresh account-status check for withdrawn and demoted seats', async () => {
  const { h } = customSession()
  const admin = h.load('lib/usage/admin.ts')
  h.usage.readAccountStatus.mock.mockImplementation(async () => ({ active: false, role: 'User' }))
  const inactive = await admin.requireAdmin()
  assert.equal(admin.adminEntryRedirect(inactive), '/login?error=inactive')
  assert.deepEqual(admin.adminRefusal(inactive), { error: 'This account is turned off.', status: 403 })
  h.usage.readAccountStatus.mock.mockImplementation(async () => ({ active: true, role: 'User' }))
  assert.equal((await admin.requireAdmin()).status, 403)
})

test('a missing usage store is an unavailable admin gate, never granted access or a login bounce', async () => {
  const { h } = customSession()
  h.usage.readAccountStatus.mock.mockImplementation(async () => { throw new h.usage.UsageStoreMissing('Synthetic store unavailable') })
  const admin = h.load('lib/usage/admin.ts')
  const gate = await admin.requireAdmin()
  assert.equal(gate.ok, false)
  assert.equal(gate.status, 503)
  assert.equal(admin.adminEntryRedirect(gate), null)
  const page = await h.load('app/admin/page.tsx').default()
  assert.equal(page.props.loadError, 'Synthetic store unavailable')
  assert.equal(h.usage.listAdminRecords.mock.callCount(), 0)
  assert.equal((await h.load('app/api/admin/admins/route.ts').GET(adminRequest())).status, 503)
})

test('a missing custom auth store returns 503 without falling back to another identity', async () => {
  const { h } = customSession()
  const { AuthStoreMissing } = h.load('lib/auth/db')
  h.prisma.authSession.findUnique.mock.mockImplementation(async () => { throw new AuthStoreMissing('Synthetic auth store unavailable') })
  const gate = await h.load('lib/usage/admin.ts').requireAdmin()
  assert.equal(gate.ok, false)
  assert.equal(gate.status, 503)
  assert.equal(h.createSupabase.mock.callCount(), 0)
})

test('a Google-only account keeps unavailable-store diagnostics instead of being sent to login', async () => {
  const h = createAuthHarness()
  h.supabase.auth.getUser.mock.mockImplementation(async () => ({ data: { user: googleUser } }))
  h.usage.readAccountStatus.mock.mockImplementation(async () => { throw new h.usage.UsageStoreMissing('Synthetic legacy store unavailable') })
  const admin = h.load('lib/usage/admin.ts')
  const gate = await admin.requireAdmin()
  assert.equal(gate.ok, false)
  assert.equal(gate.status, 503)
  assert.equal(admin.adminEntryRedirect(gate), null)
  assert.equal((await h.load('app/api/admin/admins/route.ts').GET(adminRequest())).status, 503)
  assert.equal(h.usage.listAdminRecords.mock.callCount(), 0)
})

test('a withdrawn Google-only account retains the inactive refusal', async () => {
  const h = createAuthHarness()
  h.supabase.auth.getUser.mock.mockImplementation(async () => ({ data: { user: googleUser } }))
  h.usage.readAccountStatus.mock.mockImplementation(async () => ({ active: false, role: 'User' }))
  const admin = h.load('lib/usage/admin.ts')
  const gate = await admin.requireAdmin()
  assert.equal(admin.adminEntryRedirect(gate), '/login?error=inactive')
  assert.deepEqual(admin.adminRefusal(gate), { error: 'This account is turned off.', status: 403 })
})

test('legacy diagnostics cannot grant access when the unified identity reader failed', async () => {
  const h = createAuthHarness()
  h.supabase.auth.getUser.mock.mockImplementation(async () => ({ data: { user: googleUser } }))
  h.usage.ensureProfileRecord.mock.mockImplementation(async () => { throw new Error('Synthetic profile sync failure') })
  h.usage.readAccountStatus.mock.mockImplementation(async () => ({ active: true, role: 'Owner' }))
  const gate = await h.load('lib/usage/admin.ts').requireAdmin()
  assert.equal(gate.ok, false)
  assert.equal(gate.status, 401)
  assert.equal(h.usage.listAdminRecords.mock.callCount(), 0)
})

test('unexpected identity failures never open the admin gate', async () => {
  const { h } = customSession()
  h.prisma.authSession.findUnique.mock.mockImplementation(async () => { throw new Error('Synthetic connection failure') })
  await assert.rejects(h.load('lib/usage/admin.ts').requireAdmin(), /Synthetic connection failure/)
  assert.equal(h.createSupabase.mock.callCount(), 0)
  assert.equal(h.usage.listAdminRecords.mock.callCount(), 0)
})

test('custom logout clears the cookie and revokes the token that admitted the admin', async () => {
  const { h } = customSession()
  assert.equal((await h.load('lib/usage/admin.ts').requireAdmin()).ok, true)
  h.prisma.authSession.delete.mock.mockImplementation(async () => {
    h.prisma.authSession.findUnique.mock.mockImplementation(async () => null)
    return {}
  })
  const response = await h.load('app/api/auth/logout/route.ts').POST(authRequest('/api/auth/logout', {}, {
    cookie: `smilepdf_auth=${rawCookie}`,
  }))
  assert.equal(response.status, 200)
  assert.equal(response.cookies.get('smilepdf_auth').maxAge, 0)
  assert.deepEqual(h.prisma.authSession.delete.mock.calls[0].arguments[0], {
    where: { tokenHash: h.load('lib/auth/tokens.ts').tokenHash(rawCookie) },
  })
  assert.equal((await h.load('lib/usage/admin.ts').requireAdmin()).status, 401)
})
