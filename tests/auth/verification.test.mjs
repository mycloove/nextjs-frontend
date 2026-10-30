import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAuthHarness } from './isolated-auth.mjs'

const email = 'pending@example.test'
const password = 'synthetic-password-123'
const origin = 'https://auth.example.test'
const rawToken = 'a'.repeat(64)

function noSignInWrites(h) {
  assert.equal(h.prisma.authSession.create.mock.callCount(), 0)
  assert.equal(h.prisma.authAccount.update.mock.callCount(), 0)
  assert.equal(h.prisma.user.create.mock.callCount(), 0)
  assert.equal(h.usage.readAccountStatus.mock.callCount(), 0)
}

async function loginFixture(emailVerified, userId = 'user-pending') {
  const h = createAuthHarness()
  const passwordHash = await h.load('lib/auth/hash.ts').hashPassword(password)
  h.prisma.authAccount.findUnique.mock.mockImplementation(async () => ({ id: 'account-pending', userId, passwordHash, emailVerified }))
  return h
}

for (const [name, transport, sent, reason] of [
  ['accepted mail', async () => Response.json({ messageId: 'accepted' }, { status: 201 }), true, undefined],
  ['rejected mail', async () => Response.json({ code: 'unavailable' }, { status: 503 }), false, 'brevo_http_503'],
  ['transport outage', async () => { throw new Error('Synthetic mail outage') }, false, 'mail_transport_error'],
]) {
  test(`signup persists a pending account and verification link, never a session: ${name}`, async () => {
    const h = createAuthHarness({ transport })
    const service = h.load('lib/auth/service.ts')
    const before = Date.now()
    const result = await service.signupAccount({ body: { email: ' Pending@Example.Test ', password, display_name: ' Pending Person ' }, origin })
    const after = Date.now()
    const account = h.prisma.authAccount.create.mock.calls[0].arguments[0].data
    const profile = h.prisma.user.create.mock.calls[0].arguments[0].data
    const token = h.prisma.verificationToken.create.mock.calls[0].arguments[0].data
    const [mailPath, mailInit] = h.mailTransport.mock.calls[0].arguments
    const mail = JSON.parse(mailInit.body)
    const link = new URL(mail.textContent.match(/^Verify my email: (.+)$/m)[1])

    assert.equal(account.email, email)
    assert.equal(account.emailVerified, false)
    assert.equal(account.displayName, 'Pending Person')
    assert.equal(await h.load('lib/auth/hash.ts').verifyPassword(password, account.passwordHash), true)
    assert.equal(account.userId, profile.id)
    assert.equal(result.userId, profile.id)
    assert.equal(profile.email, email)
    assert.equal(result.email, email)
    assert.equal(result.emailVerified, false)
    assert.equal(result.mailSent, sent)
    assert.equal(result.mailReason, reason)
    assert.equal(Object.hasOwn(result, 'sessionToken'), false)
    assert.equal(Object.hasOwn(account, 'lastLoginAt'), false)
    assert.equal(h.prisma.authAccount.update.mock.callCount(), 0)
    assert.equal(h.prisma.authSession.create.mock.callCount(), 0)
    assert.equal(h.createSupabase.mock.callCount(), 0)
    assert.equal(h.blockedFetch.mock.callCount(), 0)
    assert.equal(mailPath, 'https://api.brevo.com/v3/smtp/email')
    assert.deepEqual(mail.to, [{ email }])
    assert.equal(link.origin, origin)
    assert.equal(link.pathname, '/auth/verify')
    assert.match(link.searchParams.get('token'), /^[0-9a-f]{64}$/)
    assert.equal(token.tokenHash, h.load('lib/auth/tokens.ts').tokenHash(link.searchParams.get('token')))
    assert.equal(token.accountId, 'account-new')
    assert.equal(token.purpose, 'signup_verify')
    assert.ok(token.expiresAt.getTime() >= before + service.VERIFY_TTL_HOURS * 3_600_000)
    assert.ok(token.expiresAt.getTime() <= after + service.VERIFY_TTL_HOURS * 3_600_000)
    assert.equal(h.prisma.$transaction.mock.callCount(), 2)
    assert.equal(h.prisma.verificationToken.create.mock.callCount(), 1)
  })
}

for (const userId of ['user-pending', null]) {
  test(`correct password for an unverified account is email_unverified403 without any sign-in writes (profile ${userId ?? 'missing'})`, async () => {
    const h = await loginFixture(false, userId)
    const service = h.load('lib/auth/service.ts')
    await assert.rejects(service.loginAccount({ body: { email, password }, userAgent: 'auth-regression' }), (error) => {
      assert.ok(error instanceof service.AuthError)
      assert.equal(error.code, 'email_unverified')
      assert.equal(error.status, 403)
      return true
    })
    noSignInWrites(h)
    assert.equal(h.createSupabase.mock.callCount(), 0)
  })
}

for (const emailVerified of [false, true]) {
  test(`wrong password stays generic, not a verification disclosure (verified=${emailVerified})`, async () => {
    const h = await loginFixture(emailVerified)
    const service = h.load('lib/auth/service.ts')
    await assert.rejects(service.loginAccount({ body: { email, password: 'wrong-password' }, userAgent: null }), (error) => {
      assert.ok(error instanceof service.AuthError)
      assert.equal(error.code, 'invalid_credentials')
      assert.equal(error.status, 401)
      assert.equal(error.message, 'Email or password is incorrect.')
      return true
    })
    noSignInWrites(h)
    assert.equal(h.createSupabase.mock.callCount(), 0)
  })
}

test('a nonexistent account and wrong password share the generic credentials error', async () => {
  const h = createAuthHarness()
  const service = h.load('lib/auth/service.ts')
  await assert.rejects(service.loginAccount({ body: { email, password }, userAgent: null }), (error) => {
    assert.ok(error instanceof service.AuthError)
    assert.equal(error.code, 'invalid_credentials')
    assert.equal(error.status, 401)
    assert.equal(error.message, 'Email or password is incorrect.')
    return true
  })
  noSignInWrites(h)
  assert.equal(h.supabase.auth.signInWithPassword.mock.callCount(), 1)
  assert.equal(h.usage.ensureProfileRecord.mock.callCount(), 0)
})

test('verified password login creates a hashed session and records lastLoginAt', async () => {
  const h = await loginFixture(true)
  const result = await h.load('lib/auth/service.ts').loginAccount({ body: { email, password }, userAgent: 'auth-regression' })
  const session = h.prisma.authSession.create.mock.calls[0].arguments[0].data
  assert.deepEqual({ ...result, sessionToken: undefined }, {
    userId: 'user-pending', accountId: 'account-pending', email, emailVerified: true,
    role: 'User', active: true, sessionToken: undefined,
  })
  assert.match(result.sessionToken, /^[0-9a-f]{96}$/)
  assert.equal(session.accountId, result.accountId)
  assert.equal(session.tokenHash, h.load('lib/auth/tokens.ts').tokenHash(result.sessionToken))
  assert.notEqual(session.tokenHash, result.sessionToken)
  assert.equal(session.userAgent, 'auth-regression')
  assert.ok(session.expiresAt > new Date())
  assert.equal(h.prisma.authSession.create.mock.callCount(), 1)
  assert.equal(h.prisma.authAccount.update.mock.callCount(), 1)
  const update = h.prisma.authAccount.update.mock.calls[0].arguments[0]
  assert.deepEqual(update.where, { id: 'account-pending' })
  assert.ok(update.data.lastLoginAt instanceof Date)
  assert.equal(h.prisma.user.create.mock.callCount(), 0)
  assert.equal(h.createSupabase.mock.callCount(), 0)
})

function verificationFixture() {
  const h = createAuthHarness()
  const row = {
    id: 'verification-pending', accountId: 'account-pending', purpose: 'signup_verify',
    tokenHash: h.load('lib/auth/tokens.ts').tokenHash(rawToken),
    usedAt: null, expiresAt: new Date(Date.now() + 60_000),
  }
  h.prisma.verificationToken.findUnique.mock.mockImplementation(async ({ where }) => where.tokenHash === row.tokenHash ? { ...row } : null)
  h.prisma.verificationToken.updateMany.mock.mockImplementation(async ({ where, data }) => {
    // These are database predicate semantics, not a duplicate verification model.
    if (where.id !== row.id || row.usedAt !== where.usedAt || !(row.expiresAt > where.expiresAt.gt)) return { count: 0 }
    row.usedAt = data.usedAt
    return { count: 1 }
  })
  return { h, row }
}

test('verification atomically claims the link, verifies the account and revokes all its old signup sessions without logging in', async () => {
  const { h, row } = verificationFixture()
  const account = {
    id: row.accountId, userId: 'user-pending', email, emailVerified: false,
    user: { id: 'user-pending', email, role: 'User', active: true },
  }
  const oldCookie = 'b'.repeat(96)
  const sessions = [
    { accountId: account.id, tokenHash: h.load('lib/auth/tokens.ts').tokenHash(oldCookie) },
    { accountId: account.id, tokenHash: 'another-old-session' },
    { accountId: 'account-other', tokenHash: 'other-account-session' },
  ]
  h.setCookie(oldCookie)
  h.prisma.authSession.findUnique.mock.mockImplementation(async ({ where }) => sessions.some((session) => session.tokenHash === where.tokenHash)
    ? { expiresAt: new Date(Date.now() + 60_000), account } : null)
  let inTransaction = false
  h.prisma.$transaction.mock.mockImplementation(async (work) => {
    assert.equal(typeof work, 'function')
    inTransaction = true
    try { return await work(h.prisma) } finally { inTransaction = false }
  })
  const writes = []
  h.prisma.authSession.deleteMany.mock.mockImplementation(async ({ where }) => {
    assert.equal(inTransaction, true)
    writes.push('revoke')
    let count = 0
    for (let index = sessions.length - 1; index >= 0; index--) {
      if (sessions[index].accountId === where.accountId) { sessions.splice(index, 1); count++ }
    }
    return { count }
  })
  h.prisma.authAccount.update.mock.mockImplementation(async ({ where, data }) => {
    assert.equal(inTransaction, true)
    assert.equal(where.id, account.id)
    writes.push('verify')
    Object.assign(account, data)
    return account
  })
  const current = h.load('lib/auth/current-user.ts')
  assert.equal(await current.currentSessionUser(), null)
  assert.equal(await h.load('lib/auth/service.ts').consumeVerification(rawToken), 'ok')
  assert.equal(account.emailVerified, true)
  assert.deepEqual(sessions, [{ accountId: 'account-other', tokenHash: 'other-account-session' }])
  assert.equal(await current.currentSessionUser(), null, 'Verification cannot reactivate the old signup cookie')
  assert.equal(h.prisma.authSession.create.mock.callCount(), 0)
  assert.deepEqual(writes, ['revoke', 'verify'])
  assert.deepEqual(h.prisma.authSession.deleteMany.mock.calls[0].arguments[0], { where: { accountId: account.id } })
  assert.deepEqual(h.prisma.authAccount.update.mock.calls[0].arguments[0].data, { emailVerified: true })
  const claim = h.prisma.verificationToken.updateMany.mock.calls[0].arguments[0]
  assert.deepEqual(claim.where, { id: row.id, usedAt: null, expiresAt: { gt: claim.data.usedAt } })
  assert.ok(claim.data.usedAt instanceof Date)
})

test('losing the conditional token claim never verifies the account or revokes sessions', async () => {
  const { h, row } = verificationFixture()
  h.prisma.verificationToken.updateMany.mock.mockImplementation(async () => ({ count: 0 }))
  assert.equal(await h.load('lib/auth/service.ts').consumeVerification(rawToken), 'expired')
  const claim = h.prisma.verificationToken.updateMany.mock.calls[0].arguments[0]
  assert.deepEqual(claim.where, { id: row.id, usedAt: null, expiresAt: { gt: claim.data.usedAt } })
  assert.equal(h.prisma.authAccount.update.mock.callCount(), 0)
  assert.equal(h.prisma.authSession.deleteMany.mock.callCount(), 0)
  assert.equal(h.prisma.authSession.create.mock.callCount(), 0)
})

test('concurrent verification requests have exactly one winner; replay remains expired', async () => {
  const { h } = verificationFixture()
  const service = h.load('lib/auth/service.ts')
  const outcomes = await Promise.all([service.consumeVerification(rawToken), service.consumeVerification(rawToken)])
  assert.deepEqual(outcomes.sort(), ['expired', 'ok'])
  assert.equal(h.prisma.verificationToken.updateMany.mock.callCount(), 2)
  assert.equal(h.prisma.authAccount.update.mock.callCount(), 1)
  assert.equal(h.prisma.authSession.deleteMany.mock.callCount(), 1)
  assert.equal(await service.consumeVerification(rawToken), 'expired')
  assert.equal(h.prisma.authSession.create.mock.callCount(), 0)
  assert.equal(h.prisma.authAccount.update.mock.callCount(), 1)
})

for (const [name, token, rowChange] of [
  ['missing', '', null],
  ['malformed', 'not-a-token', null],
  ['unknown', 'c'.repeat(64), null],
  ['expired', rawToken, { expiresAt: new Date(0) }],
  ['already used', rawToken, { usedAt: new Date(0) }],
  ['wrong purpose', rawToken, { purpose: 'password_reset' }],
]) {
  test(`verification refuses ${name} links without account or session mutations`, async () => {
    const { h, row } = verificationFixture()
    Object.assign(row, rowChange)
    assert.equal(await h.load('lib/auth/service.ts').consumeVerification(token), 'expired')
    assert.equal(h.prisma.verificationToken.updateMany.mock.callCount(), 0)
    assert.equal(h.prisma.authAccount.update.mock.callCount(), 0)
    assert.equal(h.prisma.authSession.deleteMany.mock.callCount(), 0)
    assert.equal(h.prisma.authSession.create.mock.callCount(), 0)
  })
}

for (const state of ['unknown', 'verified', 'recent', 'pending', 'mail failure']) {
  test(`resend is enumeration-safe and never signs in: ${state}`, async () => {
    const h = createAuthHarness({ transport: async () => state === 'mail failure'
      ? Response.json({ code: 'unavailable' }, { status: 503 }) : Response.json({ messageId: 'accepted' }, { status: 201 }) })
    const account = state === 'unknown' ? null : { id: 'account-pending', displayName: 'Pending Person', emailVerified: state === 'verified' }
    h.prisma.authAccount.findUnique.mock.mockImplementation(async () => account)
    h.prisma.verificationToken.findFirst.mock.mockImplementation(async () => state === 'recent' ? { id: 'recent-token' } : null)
    assert.deepEqual(await h.load('lib/auth/service.ts').resendVerification({ body: { email }, origin }), { ok: true })
    const shouldSend = state === 'pending' || state === 'mail failure'
    assert.equal(h.mailTransport.mock.callCount(), Number(shouldSend))
    assert.equal(h.prisma.verificationToken.create.mock.callCount(), Number(shouldSend))
    assert.equal(h.prisma.authSession.create.mock.callCount(), 0)
    assert.equal(h.prisma.authAccount.update.mock.callCount(), 0)
    if (shouldSend) {
      assert.deepEqual(h.prisma.verificationToken.deleteMany.mock.calls[0].arguments[0], {
        where: { accountId: 'account-pending', purpose: 'signup_verify', usedAt: null },
      })
    }
  })
}
