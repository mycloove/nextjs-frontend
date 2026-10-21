import { failFromError, okJson, requireOwnerWrite } from '@/lib/ai/route-helpers.ts'
import { importKeysFromEnv, listAiProviderViews } from '@/lib/ai/store.ts'
import { randomUUID } from 'node:crypto'

/**
 * Brings an existing deployment onto the broker by copying GROQ_API_KEY and
 * HF_TOKEN into the store (encrypted). A provider that already has a key is left
 * untouched, so a repeated import is a no-op.
 */
export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  const gate = await requireOwnerWrite(requestId)
  if ('error' in gate) return gate.error

  try {
    const imported = await importKeysFromEnv({ actorId: gate.gate.user.id, actorEmail: gate.gate.user.email ?? null, requestId })
    const providers = await listAiProviderViews()
    return okJson({ ...imported, providers }, requestId)
  } catch (error) {
    return failFromError(error, 'Could not import from the environment', requestId)
  }
}
