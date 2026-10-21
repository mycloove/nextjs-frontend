import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AiAbortError, AiAttemptError, AllAiProvidersFailed, runWithFallback } from './execute.ts'
import type { AiChainAttempt } from './types.ts'

function attempt(keyId: string, providerId: string): AiChainAttempt {
  return {
    feature: 'document_ai_chat',
    providerId,
    providerKey: providerId,
    label: providerId,
    driver: 'openai_compatible',
    baseUrl: 'https://example.test/v1',
    model: 'chat-model',
    apiKey: `secret-${keyId}`,
    keyId,
    dim: null,
  }
}

type Mark = { keyId: string; ok: boolean; error?: string | null; cooldownMs?: number }

function recorder() {
  const marks: Mark[] = []
  return {
    marks,
    mark: async (keyId: string, result: { ok: boolean; error?: string | null; cooldownMs?: number }) => {
      marks.push({ keyId, ...result })
    },
  }
}

test('a retryable failure advances the chain and parks the key', async () => {
  const { marks, mark } = recorder()
  const seen: string[] = []
  const value = await runWithFallback(
    [attempt('k1', 'a'), attempt('k2', 'b')],
    async (candidate) => {
      seen.push(candidate.providerId)
      if (candidate.providerId === 'a') throw new AiAttemptError('rate limited', { retryable: true, status: 429 })
      return 'answered'
    },
    mark,
  )
  assert.equal(value, 'answered')
  assert.deepEqual(seen, ['a', 'b'])
  assert.deepEqual(marks[0], { keyId: 'k1', ok: false, error: 'rate limited', cooldownMs: 60_000 })
  assert.equal(marks[1].ok, true)
})

test('a non-retryable failure advances without a cooldown', async () => {
  const { marks, mark } = recorder()
  await runWithFallback(
    [attempt('k1', 'a'), attempt('k2', 'b')],
    async (candidate) => {
      if (candidate.providerId === 'a') throw new AiAttemptError('bad request', { retryable: false, status: 400 })
      return 'ok'
    },
    mark,
  )
  assert.equal(marks[0].cooldownMs, 0)
  assert.equal(marks[0].ok, false)
})

test('success clears the key', async () => {
  const { marks, mark } = recorder()
  await runWithFallback([attempt('k1', 'a')], async () => 'ok', mark)
  assert.deepEqual(marks, [{ keyId: 'k1', ok: true }])
})

test('all failures raise AllAiProvidersFailed with the last error', async () => {
  const { mark } = recorder()
  await assert.rejects(
    () =>
      runWithFallback(
        [attempt('k1', 'a'), attempt('k2', 'b')],
        async (candidate) => {
          throw new AiAttemptError(`failed ${candidate.providerId}`, { status: 500 })
        },
        mark,
      ),
    (error: unknown) => error instanceof AllAiProvidersFailed && error.attempts === 2,
  )
})

test('an unreachable service aborts without touching key health', async () => {
  const { marks, mark } = recorder()
  await assert.rejects(
    () => runWithFallback([attempt('k1', 'a')], async () => { throw new AiAbortError() }, mark),
    (error: unknown) => error instanceof AiAbortError,
  )
  assert.equal(marks.length, 0)
})

test('an empty chain throws immediately', async () => {
  const { mark } = recorder()
  await assert.rejects(() => runWithFallback([], async () => 'never', mark), AllAiProvidersFailed)
})
