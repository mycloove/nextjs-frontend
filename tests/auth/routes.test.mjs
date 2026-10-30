import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authRequest, createAuthHarness } from './isolated-auth.mjs'

const email = 'pending@example.test'
const password = 'synthetic-password-123'
const rawToken = 'e'.repeat(64)

for (const sent of [true, false]) {
  test(`signup route returns pending-account mail feedback without setting any auth cookie (mail_sent=${sent})`, async () => {
    const h = createAuthHarness({ transport: async () => sent
      ? Response.json({ messageId: 'accepted' }, { status: 201 }) : Response.json({ code: 'unavailable' }, { status: 503 }) })
    const response = await h.load('app/api/auth/signup/route.ts').POST(authRequest('/api/auth/signup', { email, password }, {
      'user-agent': 'old-signup-cookie-regression', cookie: 'smilepdf_auth=old-cookie',
    }))
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('X-Request-Id'), 'auth-test-request')
    assert.equal(response.headers.get('Set-Cookie'), null)
    assert.deepEqual(response.cookies.getAll(), [])
    assert.equal(body.user.email_verified, false)
    assert.equal(body.user.email, email)
    assert.equal(body.mail_sent, sent)
    assert.equal(body.mail_reason, sent ? null : 'brevo_http_503')
    assert.equal(body.user.id, h.prisma.user.create.mock.calls[0].arguments[0].data.id)
    assert.equal(Object.hasOwn(body, 'sessionToken'), false)
    assert.equal(h.prisma.authSession.create.mock.callCount(), 0)
  })
}

test('unverified password login route returns email_unverified403 and no authentication cookie', async () => {
  const h = createAuthHarness()
  const passwordHash = await h.load('lib/auth/hash.ts').hashPassword(password)
  h.prisma.authAccount.findUnique.mock.mockImplementation(async () => ({ id: 'account-pending', userId: 'user-pending', passwordHash, emailVerified: false }))
  const response = await h.load('app/api/auth/login/route.ts').POST(authRequest('/api/auth/login', { email, password }))
  const body = await response.json()
  assert.equal(response.status, 403)
  assert.equal(body.code, 'email_unverified')
  assert.equal(body.request_id, 'auth-test-request')
  assert.equal(response.headers.get('Set-Cookie'), null)
  assert.equal(h.prisma.authSession.create.mock.callCount(), 0)
  assert.equal(h.prisma.authAccount.update.mock.callCount(), 0)
})

test('verified password login route still issues the real auth session cookie', async () => {
  const h = createAuthHarness()
  const passwordHash = await h.load('lib/auth/hash.ts').hashPassword(password)
  h.prisma.authAccount.findUnique.mock.mockImplementation(async () => ({ id: 'account-verified', userId: 'user-verified', passwordHash, emailVerified: true }))
  const response = await h.load('app/api/auth/login/route.ts').POST(authRequest('/api/auth/login', { email, password }))
  const cookie = response.cookies.get(h.load('lib/auth/session.ts').AUTH_COOKIE)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).user.email_verified, true)
  assert.match(cookie.value, /^[0-9a-f]{96}$/)
  assert.equal(cookie.httpOnly, true)
  assert.equal(cookie.path, '/')
  assert.equal(cookie.sameSite, 'lax')
  assert.equal(h.prisma.authSession.create.mock.calls[0].arguments[0].data.tokenHash, h.load('lib/auth/tokens.ts').tokenHash(cookie.value))
})

function verificationRouteFixture() {
  const h = createAuthHarness()
  const row = {
    id: 'verify-pending', accountId: 'account-pending', purpose: 'signup_verify',
    tokenHash: h.load('lib/auth/tokens.ts').tokenHash(rawToken), usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
  }
  h.prisma.verificationToken.findUnique.mock.mockImplementation(async ({ where }) => where.tokenHash === row.tokenHash ? { ...row } : null)
  h.prisma.verificationToken.updateMany.mock.mockImplementation(async ({ data }) => { row.usedAt = data.usedAt; return { count: 1 } })
  return { h, row, get: (token) => h.load('app/auth/verify/route.ts').GET(new Request(`https://auth.example.test/auth/verify?token=${encodeURIComponent(token)}&next=https://evil.example.test`)) }
}

function assertVerificationRedirect(response, suffix) {
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('Location'), `https://auth.example.test/login?${suffix}`)
  assert.match(response.headers.get('Cache-Control'), /(?:^|[, ])no-store(?:$|[, ])/)
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer')
}

test('verification success redirects to the login form, clears an old auth cookie and never creates a session', async () => {
  const { h, get } = verificationRouteFixture()
  const response = await get(rawToken)
  assertVerificationRedirect(response, 'verified=1')
  const cookie = response.cookies.get(h.load('lib/auth/session.ts').AUTH_COOKIE)
  assert.equal(cookie.value, '')
  assert.equal(cookie.maxAge, 0)
  assert.equal(cookie.httpOnly, true)
  assert.equal(cookie.path, '/')
  assert.equal(h.prisma.authSession.create.mock.callCount(), 0)
  assert.deepEqual(h.prisma.authSession.deleteMany.mock.calls[0].arguments[0], { where: { accountId: 'account-pending' } })
  assert.deepEqual(h.prisma.authAccount.update.mock.calls[0].arguments[0].data, { emailVerified: true })
})

for (const reason of ['missing', 'invalid', 'unknown', 'expired', 'replayed', 'database outage']) {
  test(`verification route sends ${reason} links to /login?verify=error without signing in`, async () => {
    const { h, row, get } = verificationRouteFixture()
    let token = rawToken
    if (reason === 'missing') token = ''
    if (reason === 'invalid') token = 'bad-token'
    if (reason === 'unknown') token = 'f'.repeat(64)
    if (reason === 'expired') row.expiresAt = new Date(0)
    if (reason === 'replayed') assertVerificationRedirect(await get(token), 'verified=1')
    if (reason === 'database outage') h.prisma.verificationToken.findUnique.mock.mockImplementation(async () => { throw new Error('Synthetic database outage') })
    const response = await get(token)
    assertVerificationRedirect(response, 'verify=error')
    assert.equal(response.headers.get('Set-Cookie'), null)
    assert.equal(h.prisma.authSession.create.mock.callCount(), 0)
    assert.equal(h.prisma.authAccount.update.mock.callCount(), reason === 'replayed' ? 1 : 0)
  })
}

for (const [params, notice] of [[{ verified: '1' }, 'verified'], [{ verify: 'error' }, 'error']]) {
  test(`login page keeps ${notice} verification landings on the form despite a separate Google session`, async () => {
    const h = createAuthHarness()
    h.supabase.auth.getUser.mock.mockImplementation(async () => ({ data: { user: { id: 'google-user', email: 'google@example.test' } } }))
    const element = await h.load('app/login/page.tsx').default({ searchParams: Promise.resolve(params) })
    assert.equal(element.type, h.LoginClient)
    assert.equal(element.props.initialMode, 'login')
    assert.equal(element.props.verifyNotice, notice)
    assert.equal(element.props.signedInInactive, false)
    assert.equal(h.redirect.mock.callCount(), 0)
  })
}

for (const [role, location] of [['User', '/'], ['Admin', '/admin']]) {
  test(`ordinary authenticated login visits retain the ${role} redirect`, async () => {
    const h = createAuthHarness()
    h.supabase.auth.getUser.mock.mockImplementation(async () => ({ data: { user: { id: 'google-user', email: 'google@example.test' } } }))
    h.usage.readAccountStatus.mock.mockImplementation(async () => ({ active: true, role }))
    await assert.rejects(h.load('app/login/page.tsx').default({ searchParams: Promise.resolve({}) }), (error) => error.location === location)
    assert.deepEqual(h.redirect.mock.calls[0].arguments, [location])
  })
}

for (const account of [null, { id: 'account-verified', emailVerified: true }, { id: 'account-pending', emailVerified: false }]) {
  test(`resend route exposes only ok:true for ${account?.id ?? 'unknown'} and never sets a session cookie`, async () => {
    const h = createAuthHarness({ transport: async () => Response.json({ code: 'unavailable' }, { status: 503 }) })
    h.prisma.authAccount.findUnique.mock.mockImplementation(async () => account)
    const response = await h.load('app/api/auth/resend/route.ts').POST(authRequest('/api/auth/resend', { email }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
    assert.equal(response.headers.get('Set-Cookie'), null)
    assert.equal(h.prisma.authSession.create.mock.callCount(), 0)
  })
}
