import { chatProbe, DEFAULT_TEST_PROMPT } from '@/lib/ai/probe.ts'
import { fail, failFromError, okJson, readJson, requireOwnerWrite, str } from '@/lib/ai/route-helpers.ts'
import { loadKeyForProbe } from '@/lib/ai/store.ts'
import { randomUUID } from 'node:crypto'

/**
 * Sends a real chat message to one provider (and optionally one key) and returns
 * the model's reply, so an operator can confirm a key works end to end — not just
 * that the host is up. The prompt defaults to "What is your name?" and is echoed
 * back so the desk can show exactly what was asked. The key is never returned.
 */
export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  const gate = await requireOwnerWrite(requestId)
  if ('error' in gate) return gate.error

  const body = await readJson(request)
  if (!body) return fail('Invalid JSON', 400, requestId)
  const providerId = str(body.provider_id)
  if (!providerId) return fail('provider_id is required', 400, requestId)
  const prompt = str(body.prompt) || DEFAULT_TEST_PROMPT

  try {
    const { provider, apiKey } = await loadKeyForProbe(providerId, str(body.key_id) || null)
    const result = await chatProbe(provider, apiKey, prompt)
    return okJson(
      {
        provider: { id: provider.id, key: provider.key, label: provider.label },
        prompt,
        ok: result.ok,
        status: result.status,
        latency_ms: result.latency_ms,
        detail: result.detail,
        answer: result.answer,
        model: result.model,
        discovered: result.discovered,
      },
      requestId,
    )
  } catch (error) {
    return failFromError(error, 'The test failed', requestId)
  }
}
