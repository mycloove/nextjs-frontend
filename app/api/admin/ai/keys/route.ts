import { fail, failFromError, okJson, readJson, requireOwnerWrite, str } from '@/lib/ai/route-helpers.ts'
import { addAiProviderKey, deleteAiProviderKey, listAiKeyViews, rotateAiProviderKey, updateAiProviderKey } from '@/lib/ai/store.ts'
import { adminRefusal, requireAdmin } from '@/lib/usage/admin'
import { randomUUID } from 'node:crypto'

function requestIdFor(request: Request) {
  return request.headers.get('x-request-id')?.trim() || randomUUID()
}

/** Masked keys only. Any bench role may read; only an Owner may change them. */
export async function GET(request: Request) {
  const requestId = requestIdFor(request)
  const gate = await requireAdmin()
  if (!gate.ok) {
    const refusal = adminRefusal(gate)
    return fail(refusal.error, refusal.status, requestId)
  }
  const url = new URL(request.url)
  const providerId = url.searchParams.get('provider_id')
  try {
    const keys = await listAiKeyViews(providerId)
    return okJson({ keys }, requestId)
  } catch (error) {
    return okJson({ keys: [], degraded: true, message: error instanceof Error ? error.message : 'The AI store could not be read.' }, requestId)
  }
}

/** Add a key. Encrypted before it reaches the database; the plaintext is dropped. */
export async function POST(request: Request) {
  const requestId = requestIdFor(request)
  const gate = await requireOwnerWrite(requestId)
  if ('error' in gate) return gate.error

  const body = await readJson(request)
  if (!body) return fail('Invalid JSON', 400, requestId)
  const providerId = str(body.provider_id)
  const secret = typeof body.secret === 'string' ? body.secret.trim() : ''
  if (!providerId) return fail('provider_id is required', 400, requestId)
  if (!secret) return fail('A provider key is required.', 400, requestId)

  try {
    const key = await addAiProviderKey(
      { providerId, secret, label: str(body.label) || null },
      { actorId: gate.gate.user.id, actorEmail: gate.gate.user.email ?? null, requestId },
    )
    return okJson({ key }, requestId, 201)
  } catch (error) {
    return failFromError(error, 'Could not add the key', requestId)
  }
}

/**
 * Rotate (a new secret replaces the old) or update (enable/disable, label, clear
 * a cooldown). Rotation is audited with masks only.
 */
export async function PATCH(request: Request) {
  const requestId = requestIdFor(request)
  const gate = await requireOwnerWrite(requestId)
  if ('error' in gate) return gate.error

  const body = await readJson(request)
  if (!body) return fail('Invalid JSON', 400, requestId)
  const id = str(body.id)
  if (!id) return fail('id is required', 400, requestId)

  const audit = { actorId: gate.gate.user.id, actorEmail: gate.gate.user.email ?? null, requestId }
  try {
    if (typeof body.secret === 'string' && body.secret.trim()) {
      const key = await rotateAiProviderKey(id, body.secret.trim(), audit)
      return okJson({ key }, requestId)
    }
    const fields: Parameters<typeof updateAiProviderKey>[1] = {}
    if (typeof body.enabled === 'boolean') fields.enabled = body.enabled
    if (body.label !== undefined) fields.label = typeof body.label === 'string' ? body.label.trim() : null
    if (body.clear_cooldown === true) fields.clearCooldown = true
    const key = await updateAiProviderKey(id, fields, audit)
    return okJson({ key }, requestId)
  } catch (error) {
    return failFromError(error, 'Could not update the key', requestId)
  }
}

export async function DELETE(request: Request) {
  const requestId = requestIdFor(request)
  const gate = await requireOwnerWrite(requestId)
  if ('error' in gate) return gate.error

  const body = await readJson(request)
  const url = new URL(request.url)
  const id = str(body?.id) || str(url.searchParams.get('id'))
  if (!id) return fail('id is required', 400, requestId)

  try {
    await deleteAiProviderKey(id, { actorId: gate.gate.user.id, actorEmail: gate.gate.user.email ?? null, requestId })
    return okJson({ id }, requestId)
  } catch (error) {
    return failFromError(error, 'Could not delete the key', requestId)
  }
}
