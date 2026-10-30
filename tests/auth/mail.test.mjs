import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAuthHarness } from './isolated-auth.mjs'

const input = {
  to: 'pending@example.test', purpose: 'signup_verify',
  ctaUrl: `https://auth.example.test/auth/verify?token=${'a'.repeat(64)}`,
  displayName: ' Pending Person ', expiresInHours: 24, origin: 'https://auth.example.test',
}

test('verification mail goes directly to Brevo with private headers, HTML and text', async () => {
  const h = createAuthHarness()
  assert.deepEqual(await h.load('lib/auth/mail.ts').sendAccountMail(input), { sent: true })
  const [path, init] = h.mailTransport.mock.calls[0].arguments
  const body = JSON.parse(init.body)
  assert.equal(path, 'https://api.brevo.com/v3/smtp/email')
  assert.equal(init.method, 'POST')
  assert.equal(new Headers(init.headers).get('content-type'), 'application/json')
  assert.equal(new Headers(init.headers).get('api-key'), 'synthetic-api-key')
  assert.equal(new Headers(init.headers).get('X-Pdf-Service-Key'), null)
  assert.equal(init.cache, 'no-store')
  assert.ok(init.signal instanceof AbortSignal)
  assert.deepEqual(body.sender, { email: 'sender@example.test', name: 'SmilePDF' })
  assert.deepEqual(body.to, [{ email: input.to }])
  assert.equal(body.subject, 'Confirm your mycloove email')
  for (const content of [body.htmlContent, body.textContent]) {
    assert.match(content, /waiting for email verification/i)
    assert.match(content, /verify your email.*then return to the login page to sign in/i)
    assert.match(content, /Nice to meet you, Pending Person!/)
    assert.ok(content.includes(input.ctaUrl))
    assert.equal(/already (?:log|sign) in|verification is optional/i.test(content), false)
    assert.equal(content.includes('synthetic-api-key'), false)
  }
  assert.equal(Object.hasOwn(body, 'api-key'), false)
  assert.equal(Object.hasOwn(body, 'replyTo'), false)
  assert.equal(h.errors.mock.callCount(), 0)
  assert.equal(h.blockedFetch.mock.callCount(), 0)
})

for (const [name, response, expected] of [
  ['201 messageId', () => Response.json({ messageId: 'accepted' }, { status: 201 }), { sent: true }],
  ['202 messageId', () => Response.json({ messageId: 'accepted' }, { status: 202 }), { sent: true }],
  ['missing receipt', () => Response.json({}), { sent: false, reason: 'mail_invalid_response' }],
  ['old Flask response', () => Response.json({ sent: true }), { sent: false, reason: 'mail_invalid_response' }],
  ['empty receipt', () => Response.json({ messageId: '  ' }), { sent: false, reason: 'mail_invalid_response' }],
  ['numeric receipt', () => Response.json({ messageId: 1 }), { sent: false, reason: 'mail_invalid_response' }],
  ['null JSON', () => Response.json(null), { sent: false, reason: 'mail_invalid_response' }],
  ['non-JSON 200', () => new Response('Synthetic gateway HTML'), { sent: false, reason: 'mail_invalid_response' }],
  ['empty 204', () => new Response(null, { status: 204 }), { sent: false, reason: 'mail_invalid_response' }],
  ['503 rejection', () => Response.json({ message: 'synthetic-api-key' }, { status: 503 }), { sent: false, reason: 'brevo_http_503' }],
  ['401 rejection', () => Response.json({ message: 'synthetic-api-key' }, { status: 401 }), { sent: false, reason: 'brevo_http_401' }],
  ['429 quota', () => Response.json({ message: 'quota' }, { status: 429 }), { sent: false, reason: 'brevo_http_429' }],
  ['502 despite receipt', () => Response.json({ messageId: 'accepted' }, { status: 502 }), { sent: false, reason: 'brevo_http_502' }],
]) {
  test(`mail success requires both HTTP success and a Brevo acceptance receipt: ${name}`, async () => {
    const h = createAuthHarness({ transport: async () => response() })
    assert.deepEqual(await h.load('lib/auth/mail.ts').sendAccountMail(input), expected)
    assert.equal(h.mailTransport.mock.callCount(), 1)
    assert.equal(h.errors.mock.callCount(), expected.sent ? 0 : 1)
    assert.equal(JSON.stringify(h.errors.mock.calls).includes('synthetic-api-key'), false)
  })
}

for (const error of [new Error('synthetic-api-key must not leak'), new DOMException('Synthetic timeout', 'TimeoutError')]) {
  test(`mail transport ${error.name} becomes a resendable failure, never an exception`, async () => {
    const h = createAuthHarness({ transport: async () => { throw error } })
    assert.deepEqual(await h.load('lib/auth/mail.ts').sendAccountMail(input), { sent: false, reason: 'mail_transport_error' })
    assert.equal(h.errors.mock.callCount(), 1)
    assert.equal(h.mailTransport.mock.callCount(), 1)
    assert.equal(JSON.stringify(h.errors.mock.calls).includes('synthetic-api-key'), false)
  })
}

for (const env of [{ BREVO_API_KEY: '' }, { MAIL_FROM_EMAIL: '' }]) {
  test(`missing ${Object.keys(env)[0]} is a pending-account failure without any request`, async () => {
    const h = createAuthHarness({ env })
    assert.deepEqual(await h.load('lib/auth/mail.ts').sendAccountMail(input), { sent: false, reason: 'mail_not_configured' })
    assert.equal(h.mailTransport.mock.callCount(), 0)
  })
}

test('configured sender and reply-to remain private server configuration', async () => {
  const h = createAuthHarness({ env: { MAIL_FROM_NAME: ' My Team ', MAIL_REPLY_TO: ' help@example.test ' } })
  await h.load('lib/auth/mail.ts').sendAccountMail(input)
  const body = JSON.parse(h.mailTransport.mock.calls[0].arguments[1].body)
  assert.equal(body.sender.name, 'My Team')
  assert.deepEqual(body.replyTo, { email: 'help@example.test' })
})

test('personalized HTML is escaped while plain text preserves the name and link', async () => {
  const h = createAuthHarness()
  const displayName = '<img src=x onerror="steal()"> & Person'
  const ctaUrl = `${input.ctaUrl}&source="mail"`
  await h.load('lib/auth/mail.ts').sendAccountMail({ ...input, displayName, ctaUrl })
  const body = JSON.parse(h.mailTransport.mock.calls[0].arguments[1].body)
  assert.equal(body.htmlContent.includes('<img'), false)
  assert.ok(body.htmlContent.includes('&lt;img'))
  assert.ok(body.htmlContent.includes('&amp;source=&quot;mail&quot;'))
  assert.ok(body.textContent.includes(displayName))
  assert.ok(body.textContent.includes(ctaUrl))
})

for (const ctaUrl of ['javascript:alert(1)', 'https://user:secret@example.test/', 'not-a-url']) {
  test(`invalid verification link is refused before sending: ${ctaUrl}`, async () => {
    const h = createAuthHarness()
    assert.deepEqual(await h.load('lib/auth/mail.ts').sendAccountMail({ ...input, ctaUrl }), { sent: false, reason: 'mail_invalid_payload' })
    assert.equal(h.mailTransport.mock.callCount(), 0)
  })
}

test('password reset retains its own subject and CTA without changing verification behavior', async () => {
  const h = createAuthHarness()
  await h.load('lib/auth/mail.ts').sendAccountMail({ ...input, purpose: 'password_reset' })
  const body = JSON.parse(h.mailTransport.mock.calls[0].arguments[1].body)
  assert.equal(body.subject, 'Reset your mycloove password')
  assert.match(body.textContent, /Set a new password:/)
  assert.match(body.textContent, /old one keeps working until then/)
})
