import { adminPermissionRefusal, adminRefusal, checkAdminWriteRate, requireAdmin } from '@/lib/usage/admin'
import { AiConfigError } from './crypto.ts'
import { NextResponse } from 'next/server'

/**
 * Shared response plumbing for the AI bench routes. Every response carries the
 * request id in the body and the X-Request-Id header, matching the tool routes.
 */

export function withRequestId(response: NextResponse, requestId: string) {
  response.headers.set('X-Request-Id', requestId)
  return response
}

export function fail(message: string, status: number, requestId: string) {
  return withRequestId(NextResponse.json({ error: message, request_id: requestId }, { status }), requestId)
}

export function okJson(payload: Record<string, unknown>, requestId: string, status = 200) {
  return withRequestId(NextResponse.json({ ...payload, request_id: requestId }, { status }), requestId)
}

/** Throttle bench writes before touching the store. */
export function throttled(requestId: string) {
  if (checkAdminWriteRate()) return null
  return fail('Too many admin changes. Wait a minute and try again.', 429, requestId)
}

type OwnerGate = { gate: Extract<Awaited<ReturnType<typeof requireAdmin>>, { ok: true }> } | { error: NextResponse }

/**
 * The bench write gate, in the same order the tool routes use: signed-in admin,
 * Owner role, then the per-process write throttle.
 */
export async function requireOwnerWrite(requestId: string): Promise<OwnerGate> {
  const gate = await requireAdmin()
  if (!gate.ok) {
    const refusal = adminRefusal(gate)
    return { error: fail(refusal.error, refusal.status, requestId) }
  }
  const permission = adminPermissionRefusal(gate, 'owner')
  if (permission) return { error: fail(permission.error, permission.status, requestId) }
  if (!checkAdminWriteRate()) {
    return { error: fail('Too many admin changes. Wait a minute and try again.', 429, requestId) }
  }
  return { gate }
}

export function failFromError(error: unknown, fallback: string, requestId: string) {
  if (error instanceof AiConfigError) return fail(error.message, error.status, requestId)
  return fail(error instanceof Error ? error.message : fallback, 400, requestId)
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function optionalStr(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return typeof value === 'string' ? value.trim() : undefined
}
