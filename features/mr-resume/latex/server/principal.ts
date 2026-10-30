import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'

export const LATEX_GUEST_COOKIE = 'mr-resume-latex-guest'
export const LATEX_GUEST_PATH = '/api/mr-resume/latex'
export const LATEX_GUEST_TTL_SECONDS = 2 * 60 * 60
const SCOPE = 'mr-resume-latex'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export type LatexGuestPrincipal = { id: string; issuedAt: number; expiresAt: number }

export function isStrongLatexGuestSecret(secret: string | undefined): secret is string {
  return typeof secret === 'string'
    && /^[\x21-\x7e]{32,512}$/.test(secret)
    && new Set(secret).size >= 12
}

function signature(payload: string, secret: string) {
  return createHmac('sha256', secret).update(`${SCOPE}:guest:v1.${payload}`).digest()
}

export function issueLatexGuest(
  secret: string,
  now = Date.now(),
  uuid: () => string = randomUUID,
): { principal: LatexGuestPrincipal; token: string } {
  if (!isStrongLatexGuestSecret(secret)) throw new Error('Invalid LaTeX guest signing configuration')
  const id = uuid()
  if (!UUID.test(id)) throw new Error('Invalid LaTeX guest principal')
  const issuedAt = Math.floor(now / 1000)
  const expiresAt = issuedAt + LATEX_GUEST_TTL_SECONDS
  const payload = Buffer.from(JSON.stringify({ v: 1, scope: SCOPE, sub: id, iat: issuedAt, exp: expiresAt })).toString('base64url')
  return { principal: { id, issuedAt, expiresAt }, token: `v1.${payload}.${signature(payload, secret).toString('base64url')}` }
}

export function verifyLatexGuestToken(token: string, secret: string, now = Date.now()): LatexGuestPrincipal | null {
  if (!isStrongLatexGuestSecret(secret) || token.length > 1024) return null
  const match = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token)
  if (!match) return null
  try {
    const payloadBytes = Buffer.from(match[1], 'base64url')
    const actualSignature = Buffer.from(match[2], 'base64url')
    if (payloadBytes.toString('base64url') !== match[1] || actualSignature.toString('base64url') !== match[2]) return null
    const expectedSignature = signature(match[1], secret)
    if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) return null
    const payload: unknown = JSON.parse(payloadBytes.toString('utf8'))
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    const value = payload as Record<string, unknown>
    if (Object.keys(value).length !== 5 || value.v !== 1 || value.scope !== SCOPE || typeof value.sub !== 'string' || !UUID.test(value.sub)) return null
    if (typeof value.iat !== 'number' || typeof value.exp !== 'number' || !Number.isSafeInteger(value.iat) || !Number.isSafeInteger(value.exp)) return null
    const seconds = Math.floor(now / 1000)
    if (value.iat < 0 || value.iat > seconds + 5 || value.exp <= seconds || value.exp - value.iat !== LATEX_GUEST_TTL_SECONDS) return null
    return { id: value.sub, issuedAt: value.iat, expiresAt: value.exp }
  } catch {
    return null
  }
}

export function readLatexGuest(request: Request, secret: string, now = Date.now()): LatexGuestPrincipal | null {
  const cookie = request.headers.get('cookie') ?? ''
  if (cookie.length > 16 * 1024) return null
  const matches = cookie.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${LATEX_GUEST_COOKIE}=`))
  // Duplicate scoped cookies are ambiguous; none of their asserted identities wins.
  if (matches.length !== 1) return null
  return verifyLatexGuestToken(matches[0].slice(LATEX_GUEST_COOKIE.length + 1), secret, now)
}

export function latexGuestCookie(token: string, request: Request, production: boolean) {
  const secure = production || new URL(request.url).protocol === 'https:'
  return `${LATEX_GUEST_COOKIE}=${token}; Path=${LATEX_GUEST_PATH}; Max-Age=${LATEX_GUEST_TTL_SECONDS}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}

export function isTrustedLatexIpHeader(name: string) {
  return /^[a-z][a-z0-9-]{0,63}$/.test(name)
    && !['cookie', 'authorization', 'host', 'origin', 'x-request-id'].includes(name)
    && !name.startsWith('x-resume-')
}

export function latexIpFingerprint(request: Request, secret: string, trustedHeader?: string): string {
  let address = 'unknown'
  if (trustedHeader && isTrustedLatexIpHeader(trustedHeader)) {
    const candidate = request.headers.get(trustedHeader)?.trim() ?? ''
    const family = isIP(candidate)
    // A header is trusted only when the deployment explicitly names an edge-overwritten,
    // single-address field. Arbitrary forwarded chains never identify an admission bucket.
    if (family === 4) address = candidate
    if (family === 6 && !candidate.includes('%')) address = new URL(`http://[${candidate}]/`).hostname.toLowerCase()
  }
  return createHmac('sha256', secret).update(`${SCOPE}:ip:v1:${address}`).digest('hex')
}
