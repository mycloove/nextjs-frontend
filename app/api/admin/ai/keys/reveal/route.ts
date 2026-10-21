import { fail, failFromError, okJson, readJson, requireOwnerWrite, str } from '@/lib/ai/route-helpers.ts'
import { revealAiProviderKey } from '@/lib/ai/store.ts'
import { randomUUID } from 'node:crypto'

/**
 * Returns a stored provider key's plaintext for an explicit Owner reveal. The
 * desk masks by default; this is the only path that yields a full key. It is
 * owner-gated, write-throttled, audited, and never logged.
 */
export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  const gate = await requireOwnerWrite(requestId)
  if ('error' in gate) return gate.error

  const body = await readJson(request)
  const id = str(body?.id)
  if (!id) return fail('id is required', 400, requestId)

  try {
    const revealed = await revealAiProviderKey(id, {
      actorId: gate.gate.user.id,
      actorEmail: gate.gate.user.email ?? null,
      requestId,
    })
    return okJson(revealed, requestId)
  } catch (error) {
    return failFromError(error, 'Could not reveal the key', requestId)
  }
}
