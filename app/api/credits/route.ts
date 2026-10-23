import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { applyAnonCookie, readOrCreateAnonId } from '@/lib/usage/cookie'
import { creditStoreError, legacyCreditSnapshot, loadCreditSnapshot, resolveCreditActor } from '@/lib/usage/credits'

export async function GET() {
  const requestId = randomUUID()
  const { anonId, isNew } = await readOrCreateAnonId()
  try {
    const actor = await resolveCreditActor(anonId)
    const snapshot = await loadCreditSnapshot(actor)
    return applyAnonCookie(NextResponse.json(snapshot, { headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId } }), anonId, isNew)
  } catch (error) {
    const failure = creditStoreError(error)
    if (failure.code === 'credit_schema_missing' || failure.code === 'credit_store_missing') {
      return applyAnonCookie(NextResponse.json(legacyCreditSnapshot({ anonId, userId: null, active: true, unmetered: false }), { headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId } }), anonId, isNew)
    }
    return applyAnonCookie(NextResponse.json({ error: failure.message, code: failure.code, request_id: requestId }, { status: failure.status,
      headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId } }), anonId, isNew)
  }
}
