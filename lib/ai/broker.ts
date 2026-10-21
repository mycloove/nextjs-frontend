import { microserviceFetch } from '@/lib/usage/internal'
import { getPrisma } from '@/lib/usage/store'
import { AiAbortError, AiAttemptError, AllAiProvidersFailed, runWithFallback } from './execute.ts'
import { decodeProviderSecret, getDataKeyInfo, type KeyringPrisma } from './keyring.ts'
import { resolveChain, type AiPrismaLike } from './resolve.ts'
import { markKeyResult } from './store.ts'
import type { AiChainAttempt, AiFeature } from './types.ts'

/**
 * Route-facing broker. Resolves the provider chain for a feature, runs the
 * upstream call with per-request fallback, and speaks the tiny JSON contract
 * Flask answers with. Route handlers keep only their own request/response shape.
 */

export type AiCallResult = {
  status: number
  ok: boolean
  data: unknown
  /** The service could not be reached at all (connection refused / timeout). */
  transportFailed: boolean
}

export type ResolvedAi = { chat: AiChainAttempt[]; embedding: AiChainAttempt[] }

/**
 * Resolves the candidates for one feature. A missing store, an unreadable data
 * key, or an empty chain all return null, which the route reads as "use the
 * legacy env path". The data key is loaded once up front so the injected decoder
 * is synchronous and never reads the database per key.
 */
export async function resolveForRequest(kind: AiFeature): Promise<ResolvedAi | null> {
  const prisma = getPrisma()
  if (!prisma) return null
  const client = prisma as unknown as AiPrismaLike

  try {
    await getDataKeyInfo(prisma as unknown as KeyringPrisma)
  } catch {
    // Locked or unreadable keyring: keep AI working via the legacy env path
    // instead of failing every call. The bench surfaces the locked state.
    return null
  }
  const decode = (ciphertext: string) => decodeProviderSecret(ciphertext).plaintext

  try {
    if (kind === 'document_ai_embedding') {
      const embedding = await resolveChain(client, 'document_ai_embedding', decode)
      return embedding.length ? { chat: [], embedding } : null
    }
    if (kind === 'ai_analyzer_summary') {
      const chat = await resolveChain(client, 'ai_analyzer_summary', decode)
      return chat.length ? { chat, embedding: [] } : null
    }
    const chat = await resolveChain(client, 'document_ai_chat', decode)
    if (!chat.length) return null
    const embedding = await resolveChain(client, 'document_ai_embedding', decode).catch(() => [])
    return { chat, embedding }
  } catch {
    return null
  }
}

function targetShape(target: AiChainAttempt): Record<string, unknown> {
  const shape: Record<string, unknown> = {
    driver: target.driver,
    base_url: target.baseUrl,
    model: target.model,
    api_key: target.apiKey,
  }
  if (typeof target.dim === 'number') shape.dim = target.dim
  return shape
}

/**
 * base64url JSON, server-to-server only. It is encoding, not encryption — the
 * channel is the already-trusted Next↔Flask hop — so the value is treated as a
 * secret: never logged and never forwarded to the browser.
 */
export function encodeAiConfig(targets: { chat?: AiChainAttempt | null; embedding?: AiChainAttempt | null }): string {
  const payload: Record<string, unknown> = { strategy: 'provider' }
  if (targets.chat) payload.chat = targetShape(targets.chat)
  if (targets.embedding) payload.embedding = targetShape(targets.embedding)
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export async function callFlaskJson(path: string, init: RequestInit, aiConfig: string | null): Promise<AiCallResult> {
  try {
    const response = await microserviceFetch(path, { ...init, cache: 'no-store' }, aiConfig)
    const data = await response.json().catch(() => null)
    return { status: response.status, ok: response.ok, data, transportFailed: false }
  } catch {
    return { status: 0, ok: false, data: null, transportFailed: true }
  }
}

type FailureReading = { retryable: boolean; message: string; status: number | null; cooldownMs?: number }

/**
 * Reads Flask's provider-failure contract: `502 { ai_error: true, retryable,
 * status }`. Only an explicit AI error (or a 429) advances the chain, so an
 * ordinary 4xx/5xx from the app is returned to the browser untouched.
 */
export function readAiFailure(result: AiCallResult): FailureReading | null {
  if (result.ok) return null
  const data = result.data
  if (data && typeof data === 'object' && (data as Record<string, unknown>).ai_error === true) {
    const row = data as Record<string, unknown>
    return {
      retryable: row.retryable !== false,
      message: typeof row.error === 'string' && row.error ? row.error : 'The AI provider failed.',
      status: typeof row.status === 'number' ? row.status : result.status,
    }
  }
  if (result.status === 429) {
    return { retryable: true, message: 'The AI provider is rate limited.', status: 429 }
  }
  return null
}

/**
 * The single entry point the AI routes use. Runs the configured chain with
 * fallback; when there is no usable config, when every candidate fails, it makes
 * one final call with no `X-AI-Config` header so Flask uses the legacy env path.
 */
export async function brokerAiCall(kind: AiFeature, path: string, init: RequestInit): Promise<AiCallResult> {
  const run = (aiConfig: string | null) => callFlaskJson(path, init, aiConfig)
  const legacy = () => run(null)

  const resolved = await resolveForRequest(kind)
  if (!resolved) return legacy()

  const attempts = kind === 'document_ai_embedding' ? resolved.embedding : resolved.chat
  if (!attempts.length) return legacy()
  const embedding = kind === 'document_ai_embedding' ? null : (resolved.embedding[0] ?? null)

  try {
    return await runWithFallback(
      attempts,
      async (attempt) => {
        const header = encodeAiConfig({
          chat: kind === 'document_ai_embedding' ? null : attempt,
          embedding,
        })
        const result = await run(header)
        if (result.transportFailed) throw new AiAbortError()
        const failure = readAiFailure(result)
        if (failure) {
          throw new AiAttemptError(failure.message, {
            retryable: failure.retryable,
            status: failure.status,
            cooldownMs: failure.cooldownMs,
          })
        }
        return result
      },
      markKeyResult,
    )
  } catch (error) {
    if (error instanceof AllAiProvidersFailed) return legacy()
    throw error
  }
}
