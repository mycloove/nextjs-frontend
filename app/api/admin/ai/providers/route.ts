import { isAiDriver } from '@/lib/ai/catalog.ts'
import { keyringStatus, type KeyringPrisma } from '@/lib/ai/keyring.ts'
import { fail, failFromError, okJson, optionalStr, readJson, requireOwnerWrite, str } from '@/lib/ai/route-helpers.ts'
import { createAiProvider, deleteAiProvider, featureChains, listAiProviderViews, updateAiProvider } from '@/lib/ai/store.ts'
import type { KeyringStatus, ProviderView } from '@/lib/ai/types.ts'
import { adminRefusal, requireAdmin } from '@/lib/usage/admin'
import { getPrisma } from '@/lib/usage/store'
import { randomUUID } from 'node:crypto'

function requestIdFor(request: Request) {
  return request.headers.get('x-request-id')?.trim() || randomUUID()
}

/** The keyring state the bench renders. Never throws. */
async function encryptionStatus(): Promise<KeyringStatus> {
  const prisma = getPrisma()
  if (!prisma) {
    return { ready: false, locked: true, mode: null, message: 'DATABASE_URL is not set, so provider keys cannot be read or saved.' }
  }
  return keyringStatus(prisma as unknown as KeyringPrisma)
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request)
  const gate = await requireAdmin()
  if (!gate.ok) {
    const refusal = adminRefusal(gate)
    return fail(refusal.error, refusal.status, requestId)
  }
  const encryption = await encryptionStatus()
  try {
    const providers = await listAiProviderViews()
    return okJson({ providers, features: featureChains(providers), encryption_available: encryption.ready, keyring: encryption }, requestId)
  } catch (error) {
    // A read must not take the page down: a missing table or store degrades to an
    // empty bench with a message, exactly like the tools desk.
    return okJson(
      {
        providers: [] as ProviderView[],
        features: [],
        encryption_available: encryption.ready,
        keyring: encryption,
        degraded: true,
        message: error instanceof Error ? error.message : 'The AI store could not be read.',
      },
      requestId,
    )
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request)
  const gate = await requireOwnerWrite(requestId)
  if ('error' in gate) return gate.error

  const body = await readJson(request)
  if (!body) return fail('Invalid JSON', 400, requestId)
  const driver = str(body.driver)
  if (!isAiDriver(driver)) return fail('driver must be one of openai_compatible, gemini_native, huggingface', 400, requestId)
  const embeddingDimRaw = body.embedding_dim
  const embeddingDim = embeddingDimRaw === undefined || embeddingDimRaw === null ? null : Number(embeddingDimRaw)

  try {
    const provider = await createAiProvider(
      {
        key: str(body.key),
        label: str(body.label),
        driver,
        baseUrl: str(body.base_url) || null,
        chatModel: str(body.chat_model) || null,
        embeddingModel: str(body.embedding_model) || null,
        embeddingDim: Number.isFinite(embeddingDim) ? embeddingDim : null,
        sortOrder: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : undefined,
        // Optional: an operator can save the provider and its first key in one
        // step. An empty key leaves the provider keyless, to be given one later.
        apiKey: str(body.api_key) || null,
        keyLabel: str(body.key_label) || null,
      },
      { actorId: gate.gate.user.id, actorEmail: gate.gate.user.email ?? null, requestId },
    )
    return okJson({ provider }, requestId, 201)
  } catch (error) {
    return failFromError(error, 'Could not create the provider', requestId)
  }
}

export async function PATCH(request: Request) {
  const requestId = requestIdFor(request)
  const gate = await requireOwnerWrite(requestId)
  if ('error' in gate) return gate.error

  const body = await readJson(request)
  if (!body) return fail('Invalid JSON', 400, requestId)
  const id = str(body.id)
  if (!id) return fail('id is required', 400, requestId)

  const fields: Parameters<typeof updateAiProvider>[1] = {}
  if (body.label !== undefined) fields.label = str(body.label)
  if (typeof body.enabled === 'boolean') fields.enabled = body.enabled
  if (body.base_url !== undefined) fields.baseUrl = optionalStr(body.base_url) ?? null
  if (body.chat_model !== undefined) fields.chatModel = optionalStr(body.chat_model) ?? null
  if (body.embedding_model !== undefined) fields.embeddingModel = optionalStr(body.embedding_model) ?? null
  if (body.embedding_dim !== undefined) {
    const dim = body.embedding_dim === null ? null : Number(body.embedding_dim)
    fields.embeddingDim = dim !== null && Number.isFinite(dim) ? dim : null
  }
  if (body.sort_order !== undefined && Number.isFinite(Number(body.sort_order))) fields.sortOrder = Number(body.sort_order)

  try {
    const provider = await updateAiProvider(id, fields, {
      actorId: gate.gate.user.id,
      actorEmail: gate.gate.user.email ?? null,
      requestId,
    })
    return okJson({ provider }, requestId)
  } catch (error) {
    return failFromError(error, 'Could not save the provider', requestId)
  }
}

export async function DELETE(request: Request) {
  const requestId = requestIdFor(request)
  const gate = await requireOwnerWrite(requestId)
  if ('error' in gate) return gate.error

  const body = await readJson(request)
  const url = new URL(request.url)
  const id = str(body?.id) || str(url.searchParams.get('id'))
  const force = body?.force === true || url.searchParams.get('force') === 'true'
  if (!id) return fail('id is required', 400, requestId)

  try {
    await deleteAiProvider(id, force, {
      actorId: gate.gate.user.id,
      actorEmail: gate.gate.user.email ?? null,
      requestId,
    })
    return okJson({ id }, requestId)
  } catch (error) {
    return failFromError(error, 'Could not delete the provider', requestId)
  }
}
