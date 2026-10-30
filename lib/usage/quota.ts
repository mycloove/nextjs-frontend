import { randomUUID } from 'node:crypto'
import { after, NextResponse } from 'next/server'
// Identity reads go through the unified reader (custom session → Supabase bridge).
import { currentSessionUser } from '@/lib/auth/current-user'
import { applyAnonCookie, readOrCreateAnonId } from './cookie'
import { parseUsageSnapshot, quotaExceededBody } from './parse'
import { claimAnonUsage, consumeToolUsage, getPrisma, readToolSnapshot, recordSuccessfulFeatureUsage, releaseReservedUsage, UsageStoreMissing } from './store'
import type { UsageSnapshot } from './types'
import { creditDatabase, creditRequestFingerprint, creditRequestId, creditStoreError, loadCreditSnapshot, resolveCreditActor, validateCreditOrigin } from './credits'
import { claimGuestCredits, finishCreditOperation, reserveCredits, type CreditActor } from './credit-store'
import { creditInteger, CreditError } from './credit-policy'
import type { CreditSnapshot } from './credit-types'

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

function withCreditHeaders(response: NextResponse, snapshot: CreditSnapshot, cost: number) {
  response.headers.set('X-Credit-Mode', snapshot.mode)
  response.headers.set('X-Credit-Cost', String(cost))
  response.headers.set('Cache-Control', 'private, no-store')
  if (snapshot.available !== null) response.headers.set('X-Credit-Available', String(snapshot.available))
  if (snapshot.reserved !== null) response.headers.set('X-Credit-Reserved', String(snapshot.reserved))
  response.headers.set('X-Credit-Revision', String(snapshot.revision))
  return response
}

async function beginCreditQuota(request: Request, toolId: string, anonId: string, isNew: boolean, parsedBody?: unknown): Promise<QuotaOk | QuotaDenied> {
  let actor: CreditActor | undefined
  let requestId: string = randomUUID()
  try {
    validateCreditOrigin(request)
    requestId = creditRequestId(request)
    actor = await resolveCreditActor(anonId)
    if (actor.userId && actor.active) await claimGuestCredits(creditDatabase(), actor)
    const parseQuote = (value: string | null, label: string, min = 0) => {
      if (value === null) return undefined
      if (!/^\d{1,7}$/.test(value)) throw new CreditError(`Invalid ${label}.`)
      return creditInteger(Number(value), label, min)
    }
    const reservation = await reserveCredits(creditDatabase(), {
      actor, toolId, actionKey: `${request.method}:${new URL(request.url).pathname}`,
      operationKey: request.headers.get('idempotency-key')?.trim() || requestId,
      fingerprint: await creditRequestFingerprint(request, parsedBody),
      quotedCost: parseQuote(request.headers.get('x-credit-cost'), 'credit quote'),
      quotedVersion: parseQuote(request.headers.get('x-credit-price-version'), 'price version', 1),
    })
    let outcome: boolean | null = null
    let finalized = false
    let logged = false
    const operationId = reservation.operationId
    try {
      after(async () => {
        if (finalized || !operationId) return
        try { await finishCreditOperation(creditDatabase(), operationId, outcome ?? false) }
        catch { console.error('Credit reservation needs reconciliation', { operationId }) }
      })
    } catch { /* Unit transports have no Next lifecycle. apply() still settles synchronously. */ }
    const trackedUserId = actor.userId
    const apply = async (response: NextResponse, options?: QuotaApplyOptions) => {
      outcome = options?.successful ?? response.ok
      if (!finalized && operationId) {
        try { await finishCreditOperation(creditDatabase(), operationId, outcome); finalized = true }
        catch { response.headers.set('X-Credit-Pending', '1') }
      }
      if (outcome && trackedUserId && !logged) {
        logged = true
        try { await recordSuccessfulFeatureUsage(trackedUserId, toolId, randomUUID(), options?.fileName ?? null) }
        catch { console.error('Credit action analytics could not be recorded', { toolId, requestId }) }
      }
      let snapshot = reservation.snapshot
      try { snapshot = await loadCreditSnapshot(actor!) } catch { response.headers.set('X-Credit-Pending', '1') }
      return applyAnonCookie(withCreditHeaders(asNextResponse(response), snapshot, reservation.cost), anonId, isNew)
    }
    // Preserve the legacy wrapper shape for callers; credit values never enter
    // X-Usage-* headers or the public per-tool usage contract.
    return { ok: true, snapshot: parseUsageSnapshot({ allowed: true, authenticated: !!actor.userId }), apply }
  } catch (error) {
    const failure = creditStoreError(error)
    const response = NextResponse.json({ error: failure.message, code: failure.code, request_id: requestId }, { status: failure.status,
      headers: { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store', 'X-Credit-Mode': 'unavailable' } })
    if (actor) {
      try { withCreditHeaders(response, await loadCreditSnapshot(actor), 0) } catch { /* Preserve the error, never invent a balance. */ }
    }
    return { ok: false, response: applyAnonCookie(response, anonId, isNew) }
  }
}

async function currentUser() {
  // Same unified reader as resolveCreditActor: custom cookie session →
  // Supabase bridge. readAccountStatus already demoted a turned-off account
  // to guest parity inside it, so the wrapper only maps the admin bypass.
  const user = await currentSessionUser()
  if (!user) return { userId: null as string | null, isAdmin: false }
  return { userId: user.userId as string | null, isAdmin: user.role === 'Owner' || user.role === 'Operator' }
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
  parsedBody?: unknown,
): Promise<QuotaOk | QuotaDenied> {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  const { anonId, isNew } = await readOrCreateAnonId()

  const creditDb = getPrisma()
  if (creditDb) {
    try {
      const [tool, feature] = await Promise.all([
        creditDb.tool.findUnique({ where: { toolId }, select: { enabled: true, label: true } }),
        creditDb.creditPrice.findUnique({ where: { toolId }, select: { enabled: true } }),
      ])
      if (tool && !tool.enabled) {
        return { ok: false, response: applyAnonCookie(NextResponse.json({ error: `${tool.label} is turned off.`, code: 'tool_disabled', request_id: requestId }, {
          status: 403, headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId },
        }), anonId, isNew) }
      }
      if (tool && feature?.enabled === false) {
        // A feature-level opt-out means genuinely unlimited use. Keep the
        // independent availability gate above, but bypass both pooled credits
        // and legacy usage caps for this tool only.
        return { ok: true, snapshot: parseUsageSnapshot({ allowed: true }), apply: passthrough(anonId, isNew) }
      }
      const policy = await creditDb.creditPolicy.findUnique({ where: { id: 'default' }, select: { enabled: true } })
      if (policy?.enabled) return beginCreditQuota(request, toolId, anonId, isNew, parsedBody)
    } catch (error) {
      const failure = creditStoreError(error)
      if (failure.code !== 'credit_schema_missing') {
        return { ok: false, response: applyAnonCookie(NextResponse.json({ error: failure.message, code: failure.code, request_id: requestId }, {
          status: failure.status, headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId },
        }), anonId, isNew) }
      }
      // Additive schema deployment never turns off the existing legacy tools.
    }
  }

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
