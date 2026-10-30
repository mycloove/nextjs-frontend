import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAuthHarness } from './isolated-auth.mjs'

const rawCookie = 'd'.repeat(96)
const googleUser = { id: 'google-user', email: 'google@example.test', app_metadata: { provider: 'google' } }

function sessionFixture(emailVerified) {
  const h = createAuthHarness()
  const account = {
    id: 'custom-account', userId: 'custom-user', email: 'credential@example.test', emailVerified,
    user: { id: 'custom-user', email: 'profile@example.test', role: 'User', active: true },
  }
  const row = { expiresAt: new Date(Date.now() + 60_000), account }
  h.setCookie(rawCookie)
  h.prisma.authSession.findUnique.mock.mockImplementation(async () => row)
  return { h, row }
}

test('a pre-existing unverified custom session reads as guest, without profile or login mutations', async () => {
  const { h } = sessionFixture(false)
  assert.equal(await h.load('lib/auth/current-user.ts').currentSessionUser(), null)
  const query = h.prisma.authSession.findUnique.mock.calls[0].arguments[0]
  assert.equal(query.where.tokenHash, h.load('lib/auth/tokens.ts').tokenHash(rawCookie))
  assert.equal(query.select.account.select.emailVerified, true)
  assert.equal(h.usage.ensureProfileRecord.mock.callCount(), 0)
  assert.equal(h.usage.readAccountStatus.mock.callCount(), 0)
  assert.equal(h.prisma.authAccount.update.mock.callCount(), 0)
  assert.equal(h.prisma.authSession.create.mock.callCount(), 0)
})

test('a verified custom session resolves its product identity before Supabase fallback', async () => {
  const { h } = sessionFixture(true)
  assert.deepEqual(await h.load('lib/auth/current-user.ts').currentSessionUser(), {
    userId: 'custom-user', accountId: 'custom-account', email: 'profile@example.test',
    emailVerified: true, role: 'User', active: true,
  })
  assert.equal(h.createSupabase.mock.callCount(), 0)
  assert.equal(h.usage.ensureProfileRecord.mock.callCount(), 0)
})

for (const hasUnverifiedCookie of [false, true]) {
  test(`a legitimate Google session still resolves with ${hasUnverifiedCookie ? 'an ignored unverified custom cookie' : 'no custom cookie'}`, async () => {
    const h = hasUnverifiedCookie ? sessionFixture(false).h : createAuthHarness()
    h.supabase.auth.getUser.mock.mockImplementation(async () => ({ data: { user: googleUser } }))
    h.usage.readAccountStatus.mock.mockImplementation(async () => ({ role: 'Admin', active: true }))
    assert.deepEqual(await h.load('lib/auth/current-user.ts').currentSessionUser(), {
      userId: googleUser.id, accountId: googleUser.id, email: googleUser.email,
      emailVerified: true, role: 'Admin', active: true,
    })
    assert.deepEqual(h.usage.ensureProfileRecord.mock.calls[0].arguments, [googleUser.id, googleUser.email])
    assert.equal(h.prisma.authSession.findUnique.mock.callCount(), Number(hasUnverifiedCookie))
    assert.equal(h.prisma.authSession.create.mock.callCount(), 0)
  })
}

for (const reason of ['expired', 'disabled', 'missing userId', 'missing profile', 'unknown cookie']) {
  test(`unusable custom sessions cannot authenticate: ${reason}`, async () => {
    const { h, row } = sessionFixture(true)
    if (reason === 'expired') row.expiresAt = new Date(0)
    if (reason === 'disabled') row.account.user.active = false
    if (reason === 'missing userId') row.account.userId = null
    if (reason === 'missing profile') row.account.user = null
    if (reason === 'unknown cookie') h.prisma.authSession.findUnique.mock.mockImplementation(async () => null)
    assert.equal(await h.load('lib/auth/current-user.ts').currentSessionUser(), null)
    assert.equal(h.prisma.authSession.create.mock.callCount(), 0)
    assert.equal(h.prisma.authAccount.update.mock.callCount(), 0)
  })
}

test('Google fallback also respects disabled product profiles and auth outages', async () => {
  const h = createAuthHarness()
  h.supabase.auth.getUser.mock.mockImplementation(async () => ({ data: { user: googleUser } }))
  h.usage.readAccountStatus.mock.mockImplementation(async () => ({ role: 'User', active: false }))
  const current = h.load('lib/auth/current-user.ts')
  assert.equal(await current.currentSessionUser(), null)
  h.supabase.auth.getUser.mock.mockImplementation(async () => { throw new Error('Synthetic Supabase outage') })
  assert.equal(await current.currentSessionUser(), null)
  assert.equal(h.prisma.authSession.findUnique.mock.callCount(), 0)
})
