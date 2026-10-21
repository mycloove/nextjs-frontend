import { randomUUID } from 'node:crypto'
import { after, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { applyAnonCookie, readOrCreateAnonId } from './cookie'
import { parseUsageSnapshot, quotaExceededBody } from './parse'
import { claimAnonUsage, consumeToolUsage, ensureProfileRecord, readAccountStatus, readToolSnapshot, recordSuccessfulFeatureUsage, releaseReservedUsage, UsageStoreMissing } from './store'
import type { UsageSnapshot } from './types'

export type QuotaApplyOptions = {
  /**
   * Whether the wrapped work succeeded. Defaults to `response.ok` so an ordinary
   * non-2xx error response releases a reserved slot without every call site
   * having to say so; routes with a stricter notion of success (Image to Text
   * returning 200 with no recognized text) pass an explicit value.
   */
  successful?: boolean
  /** Processed file's name, recorded on the success-only activity row. */
  fileName?: string | null
}

export type QuotaOk = {
  ok: true
  snapshot: UsageSnapshot
  apply: (response: NextResponse, options?: QuotaApplyOptions) => Promise<NextResponse>
}

export type QuotaDenied = {
  ok: false
  response: NextResponse
}

function asNextResponse(response: Response): NextResponse {
  if (response instanceof NextResponse) return response
  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

function isUsageSchemaMissing(error: unknown) {
  return error instanceof UsageStoreMissing
}

function passthrough(anonId: string, persist: boolean) {
  return async (response: NextResponse) => applyAnonCookie(asNextResponse(response), anonId, persist)
}

function withUsageHeaders(response: NextResponse, snapshot: UsageSnapshot) {
  response.headers.set('X-Usage-Remaining', String(snapshot.remaining))
  response.headers.set('X-Usage-Limit', String(snapshot.limit))
  response.headers.set('X-Usage-Used', String(snapshot.used))
  if (snapshot.resets_at) response.headers.set('X-Usage-Resets-At', snapshot.resets_at)
  return response
}

async function currentUser() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  const user = data.user
  if (!user) return { userId: null as string | null, isAdmin: false }
  await ensureProfileRecord(user.id, user.email ?? null)
  // readAccountStatus is the single authority for "who may act": a turned-off
  // account is demoted to a guest here, so beginToolQuota meters it at the
  // guest cap instead of the member cap. The bench gate (requireAdmin) already
  // refuses it outright; the product path must not keep serving member quota.
  const status = await readAccountStatus(user.id)
  if (!status.active) return { userId: null as string | null, isAdmin: false }
  return { userId: user.id, isAdmin: status.role === 'Owner' || status.role === 'Operator' }
}

async function consumeUsage(anonId: string, toolId: string, requestId: string) {
  const actor = await currentUser()
  const usage = await consumeToolUsage({
    anonId,
    userId: actor.userId,
    toolId,
    requestId,
    isAdmin: actor.isAdmin,
  })
  return { usage, userId: actor.userId }
}

export async function readUsageSnapshot(toolId?: string | null): Promise<{
  snapshot: UsageSnapshot
  anonId: string
  persistCookie: boolean
}> {
  const { anonId, isNew } = await readOrCreateAnonId()
  try {
    const actor = await currentUser()
    const data = await readToolSnapshot(anonId, actor.userId, toolId ?? null)
    return {
      snapshot: parseUsageSnapshot(data, actor.isAdmin),
      anonId,
      persistCookie: isNew,
    }
  } catch (error) {
    if (isUsageSchemaMissing(error)) {
      return { snapshot: parseUsageSnapshot({ allowed: true }, false), anonId, persistCookie: isNew }
    }
    throw error instanceof Error ? error : new Error('Usage snapshot failed')
  }
}

export async function claimGuestUsage(): Promise<{
  snapshot: UsageSnapshot
  claimed: number
  anonId: string
  persistCookie: boolean
}> {
  const { anonId, isNew } = await readOrCreateAnonId()
  const actor = await currentUser()
  const claimed = actor.userId ? await claimAnonUsage(actor.userId, anonId) : 0
  const data = await readToolSnapshot(anonId, actor.userId, null)
  return {
    snapshot: parseUsageSnapshot(data, actor.isAdmin),
    claimed,
    anonId,
    persistCookie: isNew,
  }
}

export async function beginToolQuota(
  request: Request,
  toolId: string,
): Promise<QuotaOk | QuotaDenied> {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  const { anonId, isNew } = await readOrCreateAnonId()

  let data
  let userId: string | null = null
  let reserved = false
  try {
    const consumed = await consumeUsage(anonId, toolId, requestId)
    data = consumed.usage
    userId = consumed.userId
    // Only the real insert branch sets this. Dedupe hits, admin bypass, denials,
    // and unknown/disabled tools leave it false so a failed conversion can never
    // delete a row this call did not create.
    reserved = consumed.usage.reserved === true
  } catch (error) {
    if (isUsageSchemaMissing(error)) {
      console.error('Usage tables are not ready; conversions continue without a quota.', error instanceof Error ? error.message : error)
      return {
        ok: true,
        snapshot: parseUsageSnapshot({ allowed: true, used: 0, limit: 0, remaining: 0 }),
        apply: passthrough(anonId, isNew),
      }
    }
    const response = applyAnonCookie(
      NextResponse.json(
        {
          error: 'Usage tracking is unavailable. Try again in a moment.',
          code: 'usage_unavailable',
          request_id: requestId,
        },
        { status: 503, headers: { 'X-Request-Id': requestId } },
      ),
      anonId,
      isNew,
    )
    return { ok: false, response }
  }

  const snapshot = parseUsageSnapshot(data)
  const decorate = async (response: NextResponse, options?: QuotaApplyOptions) => {
    const successful = options?.successful ?? response.ok
    // Success-only quota (D2/D3): a reserved slot is released when the work did
    // not actually succeed. The snapshot is re-read after the release so the
    // X-Usage-* headers on the error describe the state the user is actually in
    // — without this the failed call would look like it consumed a slot.
    let effective = snapshot
    if (!successful && reserved) {
      try {
        await releaseReservedUsage(requestId)
        const fresh = await readToolSnapshot(anonId, userId, toolId)
        effective = parseUsageSnapshot(fresh)
      } catch (error) {
        // A release failure must never turn a finished (failed) conversion into
        // a different error; the slot simply stays reserved until it ages out.
        console.error('Could not release reserved usage', error instanceof Error ? error.message : error)
      }
    }
    const decorated = withUsageHeaders(applyAnonCookie(asNextResponse(response), anonId, isNew), effective)
    if (successful && userId) {
      try {
        after(async () => {
          try {
            await recordSuccessfulFeatureUsage(userId!, toolId, randomUUID(), options?.fileName)
          } catch (error) {
            // Analytics must never change a conversion response; an unavailable
            // analytics table/store degrades reporting only.
            console.error('Could not record successful feature use', error instanceof Error ? error.message : error)
          }
        })
      } catch (error) {
        // A missing request lifecycle context must not turn a finished feature
        // action into an error response.
        console.error('Could not schedule feature analytics', error instanceof Error ? error.message : error)
      }
    }
    return decorated
  }

  if (!snapshot.allowed) {
    if (snapshot.code === 'tool_disabled' || snapshot.code === 'tool_unknown') {
      return {
        ok: false,
        response: await decorate(
          NextResponse.json(
            {
              error: snapshot.message || 'This tool is turned off.',
              code: snapshot.code,
              request_id: requestId,
            },
            { status: 403, headers: { 'X-Request-Id': requestId } },
          ),
        ),
      }
    }
    return {
      ok: false,
      response: await decorate(
        NextResponse.json(quotaExceededBody(snapshot, requestId), {
          status: 429,
          headers: { 'X-Request-Id': requestId },
        }),
      ),
    }
  }

  return {
    ok: true,
    snapshot,
    apply: decorate,
  }
}
