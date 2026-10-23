import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { applyAnonCookie, readOrCreateAnonId } from '@/lib/usage/cookie'
import { creditStoreError, linkGuestCreditActivity, resolveCreditActor, validateCreditOrigin } from '@/lib/usage/credits'

export async function POST(request: Request) {
  const requestId = randomUUID()
  const { anonId, isNew } = await readOrCreateAnonId()
  try {
    validateCreditOrigin(request)
    const snapshot = await linkGuestCreditActivity(await resolveCreditActor(anonId))
    return applyAnonCookie(NextResponse.json(snapshot, { headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId } }), anonId, isNew)
  } catch (error) {
    const failure = creditStoreError(error)
    return applyAnonCookie(NextResponse.json({ error: failure.message, code: failure.code, request_id: requestId }, { status: failure.status,
      headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId } }), anonId, isNew)
  }
}
