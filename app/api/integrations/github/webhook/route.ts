import { setConnectionState } from '@/lib/integrations/store'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { jsonError, noStore, requestIdOf } from '../_shared'

export const dynamic = 'force-dynamic'

/**
 * POST /api/integrations/github/webhook  (Phase 3)
 *
 * Keeps the stored connection honest without polling: GitHub signs every
 * delivery, so only a body whose `X-Hub-Signature-256` matches
 * `GITHUB_WEBHOOK_SECRET` is trusted. A revoked or suspended installation flips
 * the row to `revoked`/`needs_reauth`, which is what the UI reads on next load.
 *
 * There is no session here — GitHub is the caller — so this route is verified by
 * signature alone and never touches another account's rows beyond the
 * installation id GitHub names.
 */

type WebhookPayload = {
  action?: string
  installation?: { id?: number } | null
}

/** Maps a GitHub installation action to the status we store. Unknown → null. */
export function statusForInstallationAction(action: string): string | null {
  switch (action) {
    case 'deleted':
      return 'revoked'
    case 'suspend':
      return 'needs_reauth'
    case 'created':
    case 'unsuspend':
    case 'new_permissions_accepted':
      return 'connected'
    default:
      return null
  }
}

function verifySignature(secret: string, raw: string, header: string | null): boolean {
  if (!header || !header.startsWith('sha256=')) return false
  const provided = header.slice('sha256='.length)
  const expected = createHmac('sha256', secret).update(raw).digest('hex')
  const left = Buffer.from(provided)
  const right = Buffer.from(expected)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export async function POST(request: Request) {
  const requestId = requestIdOf(request)
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim()
  if (!secret) return jsonError(requestId, 'The webhook secret is not configured.', 'config_missing', 503)

  const raw = await request.text()
  if (!verifySignature(secret, raw, request.headers.get('x-hub-signature-256'))) {
    return jsonError(requestId, 'The webhook signature did not verify.', 'github_unauthorized', 401)
  }

  const event = request.headers.get('x-github-event') ?? ''
  let payload: WebhookPayload
  try {
    payload = JSON.parse(raw) as WebhookPayload
  } catch {
    return jsonError(requestId, 'The webhook body was not JSON.', 'invalid_request', 400)
  }

  // installation_repositories (repo set changed) needs no status change: the
  // installation is still live, and the picker re-reads the granted list on use.
  if (event === 'installation') {
    const action = payload.action ?? ''
    const installationId = payload.installation?.id
    const status = statusForInstallationAction(action)
    if (status && installationId) {
      try {
        await setConnectionState(String(installationId), status)
      } catch (error) {
        console.error('GitHub webhook could not update connection state', { requestId, error: error instanceof Error ? error.message : error })
        return new NextResponse(null, { status: 503, headers: noStore(requestId) })
      }
    }
  }

  return new NextResponse(null, { status: 204, headers: noStore(requestId) })
}
