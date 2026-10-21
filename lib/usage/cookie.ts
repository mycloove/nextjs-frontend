import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export const ANON_COOKIE = 'smilepdf_anon'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const ANON_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 400,
}

export function isAnonId(value: string | undefined | null): value is string {
  return Boolean(value && UUID_RE.test(value))
}

export async function readOrCreateAnonId(): Promise<{ anonId: string; isNew: boolean }> {
  const jar = await cookies()
  const existing = jar.get(ANON_COOKIE)?.value
  if (isAnonId(existing)) return { anonId: existing, isNew: false }
  return { anonId: randomUUID(), isNew: true }
}

export function applyAnonCookie(
  response: NextResponse,
  anonId: string,
  persist: boolean,
) {
  if (persist) response.cookies.set(ANON_COOKIE, anonId, ANON_COOKIE_OPTIONS)
  return response
}
