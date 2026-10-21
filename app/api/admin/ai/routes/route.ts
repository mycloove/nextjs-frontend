import { isAiFeature } from '@/lib/ai/catalog.ts'
import { fail, failFromError, okJson, readJson, requireOwnerWrite, str } from '@/lib/ai/route-helpers.ts'
import { featureChains, listAiProviderViews, setFeatureChain } from '@/lib/ai/store.ts'
import { adminRefusal, requireAdmin } from '@/lib/usage/admin'
import { randomUUID } from 'node:crypto'

function requestIdFor(request: Request) {
  return request.headers.get('x-request-id')?.trim() || randomUUID()
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request)
  const gate = await requireAdmin()
  if (!gate.ok) {
    const refusal = adminRefusal(gate)
    return fail(refusal.error, refusal.status, requestId)
  }
  try {
    const providers = await listAiProviderViews()
    return okJson({ features: featureChains(providers) }, requestId)
  } catch (error) {
    return okJson({ features: [], degraded: true, message: error instanceof Error ? error.message : 'The AI store could not be read.' }, requestId)
  }
}

/**
 * Sets the whole ordered chain for one feature. Embeddings accept a single
 * provider — the store rejects anything longer.
 */
export async function PUT(request: Request) {
  const requestId = requestIdFor(request)
  const gate = await requireOwnerWrite(requestId)
  if ('error' in gate) return gate.error

  const body = await readJson(request)
  if (!body) return fail('Invalid JSON', 400, requestId)
  const feature = str(body.feature)
  if (!isAiFeature(feature)) return fail('Unknown feature.', 400, requestId)
  const providerIds = Array.isArray(body.provider_ids) ? body.provider_ids.filter((id): id is string => typeof id === 'string') : []
  if (!Array.isArray(body.provider_ids)) return fail('provider_ids must be an array.', 400, requestId)

  try {
    const providers = await setFeatureChain(feature, providerIds, {
      actorId: gate.gate.user.id,
      actorEmail: gate.gate.user.email ?? null,
      requestId,
    })
    return okJson({ providers, features: featureChains(providers) }, requestId)
  } catch (error) {
    return failFromError(error, 'Could not save the chain', requestId)
  }
}
