import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import {
  LATEX_GUEST_COOKIE, LATEX_GUEST_PATH, LATEX_GUEST_TTL_SECONDS, isStrongLatexGuestSecret, isTrustedLatexIpHeader,
  issueLatexGuest, latexGuestCookie, latexIpFingerprint, readLatexGuest, verifyLatexGuestToken,
} from './principal.ts'

const secret = 'unit-only-a9sE07pV24qK86wZ10nR59dG31tY68mF42cL95uH73'
const id = '75f7b103-2b30-4df1-9a0d-9cb584d1634a'
const otherId = '542a6031-f608-4ee6-8e63-5d92b16df1f0'
const now = Date.parse('2026-10-29T09:00:00Z')
const request = (headers?: HeadersInit, url = 'https://resume.example/api/mr-resume/latex/capabilities') => new Request(url, { headers })

test('signed feature-scoped guest tokens verify only their exact opaque principal and lifetime', () => {
  const guest = issueLatexGuest(secret, now, () => id)
  assert.equal(guest.principal.id, id)
  assert.equal(guest.principal.expiresAt - guest.principal.issuedAt, LATEX_GUEST_TTL_SECONDS)
  assert.deepEqual(verifyLatexGuestToken(guest.token, secret, now), guest.principal)
  assert.equal(verifyLatexGuestToken(guest.token, `${secret}different`, now), null)
  assert.equal(verifyLatexGuestToken(guest.token, secret, now + LATEX_GUEST_TTL_SECONDS * 1000), null)
  assert.equal(verifyLatexGuestToken(issueLatexGuest(secret, now + 60_000, () => id).token, secret, now), null)
})

test('tampering, noncanonical encoding and correctly signed wrong-scope/lifetime claims fail closed', () => {
  const { token } = issueLatexGuest(secret, now, () => id)
  const [, payload, signature] = token.split('.')
  const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), sub: otherId })).toString('base64url')
  assert.equal(verifyLatexGuestToken(`v1.${changed}.${signature}`, secret, now), null)
  for (const modifications of [{ scope: 'another-feature' }, { exp: Math.floor(now / 1000) + 30 }, { sub: 'anonymous' }, { v: 2 }, { extra: 'identity' }]) {
    const altered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), ...modifications })).toString('base64url')
    const signed = createHmac('sha256', secret).update(`mr-resume-latex:guest:v1.${altered}`).digest('base64url')
    assert.equal(verifyLatexGuestToken(`v1.${altered}.${signed}`, secret, now), null)
  }
  for (const invalid of [`${token}=`, `v1.${payload}=.${signature}`, `v2.${payload}.${signature}`, `${token}.extra`, 'not-a-token']) assert.equal(verifyLatexGuestToken(invalid, secret, now), null)
})

test('unsigned existing guest metering cookies and ambiguous scoped cookies never authorize private artifacts', () => {
  const { token, principal } = issueLatexGuest(secret, now, () => id)
  assert.equal(readLatexGuest(request({ Cookie: `guest_id=${id}` }), secret, now), null)
  assert.deepEqual(readLatexGuest(request({ Cookie: `guest_id=untrusted; ${LATEX_GUEST_COOKIE}=${token}; other=1` }), secret, now), principal)
  assert.equal(readLatexGuest(request({ Cookie: `${LATEX_GUEST_COOKIE}=${token}; ${LATEX_GUEST_COOKIE}=${token}` }), secret, now), null)
  assert.equal(readLatexGuest(request({ Cookie: `${LATEX_GUEST_COOKIE}=forged; ${LATEX_GUEST_COOKIE}=${token}` }), secret, now), null)
})

test('guest cookie is HttpOnly, SameSite Strict and module-scoped, with Secure only on HTTPS or production', () => {
  const { token } = issueLatexGuest(secret, now, () => id)
  const http = latexGuestCookie(token, request({ 'X-Forwarded-Proto': 'https' }, 'http://localhost:3000/api/mr-resume/latex/capabilities'), false)
  assert.match(http, new RegExp(`Path=${LATEX_GUEST_PATH}`))
  assert.match(http, /HttpOnly; SameSite=Strict/)
  assert.doesNotMatch(http, /; Secure/)
  assert.match(latexGuestCookie(token, request(), false), /; Secure$/)
  assert.match(latexGuestCookie(token, request(undefined, 'http://localhost:3000/api/mr-resume/latex/capabilities'), true), /; Secure$/)
  assert.doesNotMatch(http, /Domain=/)
})

test('no arbitrary forwarded/client identity header becomes an IP admission identity by default', () => {
  const unknown = latexIpFingerprint(request(), secret)
  const spoofed = latexIpFingerprint(request({ 'X-Forwarded-For': '203.0.113.42', 'X-Real-IP': '198.51.100.99', 'X-Resume-IP': 'spoofed', Forwarded: 'for=192.0.2.3' }), secret)
  assert.equal(unknown, spoofed)
  assert.match(unknown, /^[0-9a-f]{64}$/)
  assert.notEqual(unknown, createHmac('sha256', secret).update('unknown').digest('hex'))
  assert.notEqual(unknown, latexIpFingerprint(request(), `${secret}rotated`))
})

test('only an explicitly trusted single-address field is hashed, with conservative fallback for chains/invalid IPs', () => {
  const unknown = latexIpFingerprint(request(), secret)
  const first = latexIpFingerprint(request({ 'X-Real-IP': '203.0.113.42' }), secret, 'x-real-ip')
  assert.notEqual(first, unknown)
  assert.notEqual(first, latexIpFingerprint(request({ 'X-Real-IP': '203.0.113.43' }), secret, 'x-real-ip'))
  assert.equal(unknown, latexIpFingerprint(request({ 'X-Forwarded-For': '203.0.113.42, 192.0.2.1' }), secret, 'x-forwarded-for'))
  assert.equal(unknown, latexIpFingerprint(request({ 'X-Real-IP': 'not-an-ip' }), secret, 'x-real-ip'))
  assert.equal(unknown, latexIpFingerprint(request({ 'X-Real-IP': 'fe80::1%eth0' }), secret, 'x-real-ip'))
  assert.equal(latexIpFingerprint(request({ 'X-Real-IP': '2001:db8::1' }), secret, 'x-real-ip'), latexIpFingerprint(request({ 'X-Real-IP': '2001:0db8:0:0:0:0:0:1' }), secret, 'x-real-ip'))
  for (const invalid of ['authorization', 'cookie', 'x-resume-ip', 'x-resume-principal', 'x-request-id', 'x real ip']) assert.equal(isTrustedLatexIpHeader(invalid), false)
})

test('weak or missing signing setup cannot mint a guest identity', () => {
  assert.equal(isStrongLatexGuestSecret(secret), true)
  for (const invalid of [undefined, '', 'short-secret', 'a'.repeat(64), `${secret}\n`, ' '.repeat(64)]) assert.equal(isStrongLatexGuestSecret(invalid), false)
  assert.throws(() => issueLatexGuest('weak', now, () => id))
  assert.throws(() => issueLatexGuest(secret, now, () => 'unverified-user-id'))
})
