import type { AiChainAttempt } from './types.ts'

/**
 * The per-request fallback loop. Kept free of store imports so it can be tested
 * without a database: the caller passes the `mark` function that records key
 * health.
 */

export type AiMarkFn = (
  keyId: string,
  result: { ok: boolean; error?: string | null; cooldownMs?: number },
) => Promise<void>

export type AiAttemptFailure = {
  ok: false
  error: string
  retryable: boolean
  status: number | null
  cooldownMs: number
}

/**
 * Thrown by the caller's `call` when the upstream refused in a way that should
 * advance the chain. `retryable` decides whether the key is parked on cooldown:
 * a free-tier 429 is retryable and parked, a malformed-request 400 is not.
 */
export class AiAttemptError extends Error {
  retryable: boolean
  status: number | null
  cooldownMs: number
  constructor(message: string, options: { retryable?: boolean; status?: number | null; cooldownMs?: number } = {}) {
    super(message)
    this.name = 'AiAttemptError'
    this.retryable = options.retryable !== false
    this.status = options.status ?? null
    this.cooldownMs = options.cooldownMs ?? 0
  }
}

/**
 * Aborts the whole chain without touching key health. Used when the AI service
 * itself is unreachable (connection refused, timeout): every candidate would
 * fail identically, and parking keys for a dead service is wrong.
 */
export class AiAbortError extends Error {
  constructor(message = 'The AI service is unreachable.') {
    super(message)
    this.name = 'AiAbortError'
  }
}

/** Raised when every candidate failed; the broker falls back to the legacy path. */
export class AllAiProvidersFailed extends Error {
  attempts: number
  lastError: string | null
  constructor(attempts: number, lastError: string | null) {
    super(lastError ? `All AI providers failed: ${lastError}` : 'All AI providers failed.')
    this.name = 'AllAiProvidersFailed'
    this.attempts = attempts
    this.lastError = lastError
  }
}

const DEFAULT_COOLDOWN_MS = 30_000
const RATE_LIMIT_COOLDOWN_MS = 60_000

/** 429 parks a key for longer than a generic 5xx; a bad key parks it too. */
export function cooldownForStatus(status: number | null): number {
  if (status === 429 || status === 402) return RATE_LIMIT_COOLDOWN_MS
  return DEFAULT_COOLDOWN_MS
}

function classify(error: unknown): AiAttemptFailure {
  if (error instanceof AiAttemptError) {
    const retryable = error.retryable
    return {
      ok: false,
      error: error.message,
      retryable,
      status: error.status,
      cooldownMs: retryable ? error.cooldownMs || cooldownForStatus(error.status) : 0,
    }
  }
  return {
    ok: false,
    error: error instanceof Error ? error.message : 'AI provider failed',
    retryable: true,
    status: null,
    cooldownMs: DEFAULT_COOLDOWN_MS,
  }
}

/**
 * Runs `call` against each attempt in order. On a failure the key is marked (a
 * cooldown only for a retryable one) and the next candidate is tried. Returns
 * the first success; throws AllAiProvidersFailed when none succeed and no
 * candidates exist.
 */
export async function runWithFallback<T>(
  attempts: AiChainAttempt[],
  call: (attempt: AiChainAttempt) => Promise<T>,
  mark: AiMarkFn,
): Promise<T> {
  if (!attempts.length) throw new AllAiProvidersFailed(0, null)

  let lastError: string | null = null
  for (const attempt of attempts) {
    try {
      const value = await call(attempt)
      await mark(attempt.keyId, { ok: true }).catch(() => {})
      return value
    } catch (error) {
      if (error instanceof AiAbortError) throw error
      const failure = classify(error)
      lastError = failure.error
      await mark(attempt.keyId, {
        ok: false,
        error: failure.error,
        cooldownMs: failure.cooldownMs,
      }).catch(() => {})
    }
  }
  throw new AllAiProvidersFailed(attempts.length, lastError)
}
