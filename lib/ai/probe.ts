import type { ProviderView } from './types.ts'

/**
 * A real chat round-trip against one provider + key, run from the Next.js server
 * with a single decrypted key. It sends a user prompt and returns the model's own
 * words, so an operator can see that the key actually works.
 *
 * Model handling is forgiving: if the provider has no `chat_model`, or the saved
 * one is rejected (a free tier that dropped a model, an account without access),
 * the probe reads the provider's own `/models` list and retries with a model that
 * is actually available. That is what makes "just paste a key" work. The key is
 * carried in a header (never the URL) and is never returned, logged, or echoed.
 */

export type ChatProbeResult = {
  ok: boolean
  status: number
  latency_ms: number
  detail: string
  /** The model's reply when it produced one; null on any failure. */
  answer: string | null
  /** The model that answered, or the one that was attempted on failure. */
  model: string | null
  /** True when the model came from discovery rather than the saved chat_model. */
  discovered: boolean
}

export const DEFAULT_TEST_PROMPT = 'What is your name?'

const CHAT_TIMEOUT_MS = 20_000
const DISCOVERY_TIMEOUT_MS = 8_000
const MAX_ANSWER_CHARS = 2000
const MAX_DISCOVERY_TRIES = 8

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/** `choices[0].message.content`, the OpenAI-compatible reply shape. */
function firstOpenAiText(data: unknown): string {
  const choices = asRecord(data)?.choices
  if (!Array.isArray(choices) || !choices.length) return ''
  const message = asRecord(asRecord(choices[0])?.message)
  const content = message?.content
  return typeof content === 'string' ? content : ''
}

/** `candidates[0].content.parts[].text`, the Gemini reply shape. */
function firstGeminiText(data: unknown): string {
  const candidates = asRecord(data)?.candidates
  if (!Array.isArray(candidates) || !candidates.length) return ''
  const parts = asRecord(asRecord(candidates[0])?.content)?.parts
  if (!Array.isArray(parts)) return ''
  return parts
    .map((part) => {
      const text = asRecord(part)?.text
      return typeof text === 'string' ? text : ''
    })
    .join('')
}

/** A message out of a bare string, or an object's `message` field. */
function stringOrMessage(value: unknown): string {
  if (typeof value === 'string') return value
  const message = asRecord(value)?.message
  return typeof message === 'string' ? message : ''
}

/**
 * The human text of a provider error. Providers wrap it differently — OpenAI and
 * Anthropic use `error.message`, Cloudflare uses `errors: [{ message }]`, some
 * use `detail` — so every known shape is checked before falling back to the code.
 * Without this, a Cloudflare 404 (e.g. a placeholder account id) rendered as a
 * bare "HTTP 404" with no clue what was wrong.
 */
function errorText(data: unknown, status: number): string {
  const record = asRecord(data)
  if (record) {
    const flat = [stringOrMessage(record.error), stringOrMessage(record.message), stringOrMessage(record.detail)]
    for (const candidate of flat) {
      if (candidate.trim()) return candidate.trim().replace(/\s+/g, ' ').slice(0, 300)
    }
    const errors = record.errors
    if (Array.isArray(errors)) {
      for (const entry of errors) {
        const text = stringOrMessage(entry)
        if (text.trim()) return text.trim().replace(/\s+/g, ' ').slice(0, 300)
      }
    }
  }
  return `HTTP ${status}`
}

/**
 * A 4xx whose text blames the model — the cue to fall back to discovery. Gemini
 * returns "Your project has been denied access" for models a free project cannot
 * use, so it gets the broader tokens; other drivers keep the narrow set so their
 * behaviour is unchanged.
 */
function looksLikeModelError(result: { status: number; detail: string }, driver: ProviderView['driver']): boolean {
  if (result.status !== 400 && result.status !== 403 && result.status !== 404) return false
  const pattern =
    driver === 'gemini_native'
      ? /model|not found|does not exist|no access|denied|permission|unsupported|deprecat|decommission/i
      : /model|not found|does not exist|no access|decommission|unsupported|deprecat/i
  return pattern.test(result.detail)
}

/**
 * Pulls `models/<id>` names out of an error message. Google's retired-model
 * error names the replacement ("use models/gemini-3.1-pro-preview"), so the model
 * it recommends can be tried even when the model list is unreachable.
 */
function suggestedModels(detail: string): string[] {
  const ids: string[] = []
  const pattern = /models\/([A-Za-z0-9._-]+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(detail)) !== null) {
    // The id ends at the sentence's punctuation, not inside it.
    const id = match[1]?.replace(/[.\-_]+$/, '')
    if (id) ids.push(id)
  }
  return [...new Set(ids)]
}

// Speech, audio, embedding and moderation models are never a chat candidate.
const NON_CHAT_TOKENS = ['whisper', 'tts', 'speech', 'audio', 'embed', 'rerank', 'guard', 'moderation', 'dall', 'stable-diffusion', 'vision-encoder']
// Gemini lists image/audio/embedding models that share the `generateContent`
// verb but are not text chat models — and on a free project they answer with
// "Your project has been denied access". Keep them out of the candidate list.
const GEMINI_NON_TEXT = /(embedding|aqa|imagen|image|vision|veo|tts|audio|live|learnlm)/i
// Preferred chat models, best first, so a discovered list is ordered usefully.
const CHAT_PREFERENCES = [
  'llama-3.3-70b', 'llama-3.1-70b', 'llama-3.3', 'llama-3.1-8b', 'llama-3', 'llama3',
  'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash',
  'mixtral', 'qwen3', 'qwen2', 'mistral-small', 'mistral-large', 'gpt-4o-mini', 'gpt-4o', 'gemma2',
]

function isChatModel(id: string): boolean {
  const lower = id.toLowerCase()
  if (!lower) return false
  return !NON_CHAT_TOKENS.some((token) => lower.includes(token))
}

/** Preview/experimental variants come after the stable ids of the same version. */
function isPreviewModel(id: string): boolean {
  return /preview|exp|experimental|thinking|-\d{2}-\d{2}$/i.test(id)
}

/** `gemini-3.1-pro-preview` → [3, 1]. Missing parts count as zero. */
function geminiVersion(id: string): [number, number] {
  const match = id.match(/gemini-(\d+)(?:\.(\d+))?/i)
  return match ? [Number(match[1]), Number(match[2] ?? 0)] : [0, 0]
}

/** Within one version, the cheaper free-tier families are tried first. */
function geminiFamily(id: string): number {
  const lower = id.toLowerCase()
  if (lower.includes('flash-lite')) return 0
  if (lower.includes('flash')) return 1
  if (lower.includes('pro')) return 2
  return 3
}

function rankModel(id: string): number {
  const lower = id.toLowerCase()
  const index = CHAT_PREFERENCES.findIndex((prefix) => lower.includes(prefix))
  return index === -1 ? CHAT_PREFERENCES.length : index
}

/**
 * Reads the provider's own model list and returns chat-capable ids, best first.
 * Never throws: an unreachable or unparsable list is simply an empty result, and
 * the caller reports that the model could not be discovered.
 */
async function listModels(provider: ProviderView, apiKey: string): Promise<string[]> {
  const base = (provider.base_url ?? '').replace(/\/$/, '')
  if (!base) return []
  const gemini = provider.driver === 'gemini_native'
  const headers: Record<string, string> = {}
  if (gemini) headers['x-goog-api-key'] = apiKey
  else headers['Authorization'] = `Bearer ${apiKey}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
  try {
    const response = await fetch(`${base}/models`, { headers, signal: controller.signal, cache: 'no-store' })
    if (!response.ok) return []
    const data = await response.json().catch(() => null)
    const record = asRecord(data)
    const rows = gemini ? record?.models : record?.data ?? record?.models
    if (!Array.isArray(rows)) return []

    const ids: string[] = []
    for (const row of rows) {
      const item = asRecord(row)
      if (!item) continue
      const raw = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : ''
      const id = raw.replace(/^models\//, '').trim()
      if (!id) continue
      if (gemini) {
        if (GEMINI_NON_TEXT.test(id)) continue
        const methods = Array.isArray(item.supportedGenerationMethods) ? item.supportedGenerationMethods : []
        if (methods.length && !methods.includes('generateContent')) continue
      } else if (!isChatModel(id)) {
        continue
      }
      ids.push(id)
    }
    const unique = [...new Set(ids)]
    if (gemini) {
      // Newest version first — a new key may only have the newest models — then
      // the cheaper family, then stable before preview, then the shorter id.
      return unique.sort((a, b) => {
        const [aMajor, aMinor] = geminiVersion(a)
        const [bMajor, bMinor] = geminiVersion(b)
        return (
          bMajor - aMajor ||
          bMinor - aMinor ||
          geminiFamily(a) - geminiFamily(b) ||
          Number(isPreviewModel(a)) - Number(isPreviewModel(b)) ||
          a.length - b.length ||
          a.localeCompare(b)
        )
      })
    }
    return unique.sort((a, b) => rankModel(a) - rankModel(b) || a.localeCompare(b))
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

type ChatCallResult = Pick<ChatProbeResult, 'ok' | 'status' | 'latency_ms' | 'detail' | 'answer'>

async function callChat(provider: ProviderView, apiKey: string, model: string, prompt: string): Promise<ChatCallResult> {
  const base = (provider.base_url ?? '').replace(/\/$/, '')
  const gemini = provider.driver === 'gemini_native'
  const url = gemini ? `${base}/models/${model}:generateContent` : `${base}/chat/completions`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (gemini) headers['x-goog-api-key'] = apiKey
  else headers['Authorization'] = `Bearer ${apiKey}`
  const body = gemini
    ? { contents: [{ parts: [{ text: prompt }] }] }
    : { model, messages: [{ role: 'user', content: prompt }], temperature: 0.2 }

  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    })
    const latency = Date.now() - started
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      return { ok: false, status: response.status, latency_ms: latency, detail: errorText(data, response.status), answer: null }
    }
    const answer = (gemini ? firstGeminiText(data) : firstOpenAiText(data)).trim()
    if (!answer) {
      return { ok: false, status: response.status, latency_ms: latency, detail: 'The provider answered, but no text came back.', answer: null }
    }
    return { ok: true, status: response.status, latency_ms: latency, detail: 'The provider answered.', answer: answer.slice(0, MAX_ANSWER_CHARS) }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      ok: false,
      status: 0,
      latency_ms: Date.now() - started,
      detail: aborted
        ? 'The provider did not answer within 20 seconds.'
        : error instanceof Error
          ? error.message
          : 'Could not reach the provider.',
      answer: null,
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function chatProbe(
  provider: ProviderView,
  apiKey: string,
  prompt: string = DEFAULT_TEST_PROMPT,
): Promise<ChatProbeResult> {
  const base = (provider.base_url ?? '').replace(/\/$/, '')
  if (!base) {
    return { ok: false, status: 0, latency_ms: 0, detail: 'No base URL is set for this provider.', answer: null, model: null, discovered: false }
  }
  // A seeded provider can carry a placeholder (Cloudflare's account id), which the
  // operator must replace. Say so plainly instead of letting it fail as an opaque
  // 404 from `…/accounts/YOUR_ACCOUNT_ID/…`.
  if (/YOUR_[A-Z0-9_]+/.test(base)) {
    return {
      ok: false,
      status: 0,
      latency_ms: 0,
      detail: `The base URL still contains a placeholder (${base}). Replace it with your real value — for Cloudflare that is your account id — under “Edit models and base URL”.`,
      answer: null,
      model: provider.chat_model?.trim() || null,
      discovered: false,
    }
  }

  const configured = provider.chat_model?.trim() || null
  let configuredFailure: ChatCallResult | null = null

  // The saved model is tried first. Any failure worth rediscovering on falls
  // through to the model list: for Gemini that is any failure at all, because
  // retired ("no longer available to new users") and denied models come back with
  // varied statuses and wording. Other drivers only rediscover on a model-shaped
  // error, so their behaviour is unchanged.
  if (configured) {
    const result = await callChat(provider, apiKey, configured, prompt)
    if (result.ok) return { ...result, model: configured, discovered: false }
    const shouldDiscover = provider.driver === 'gemini_native' ? true : looksLikeModelError(result, provider.driver)
    if (!shouldDiscover) return { ...result, model: configured, discovered: false }
    configuredFailure = result
  }

  // Prefer the model the provider itself names in the error (Gemini's retired
  // message points at its replacement), then the live model list.
  const suggested = configuredFailure && provider.driver === 'gemini_native' ? suggestedModels(configuredFailure.detail) : []
  const live = await listModels(provider, apiKey)
  const candidates = [...new Set([...suggested, ...live])].filter((id) => id !== configured)

  if (!candidates.length) {
    if (configuredFailure) {
      return {
        ...configuredFailure,
        model: configured,
        discovered: false,
        detail: `${configuredFailure.detail} No alternative chat model could be discovered from ${base}/models.`,
      }
    }
    return { ok: false, status: 0, latency_ms: 0, detail: `No chat model is set, and none could be discovered from ${base}/models.`, answer: null, model: null, discovered: false }
  }

  let last: ChatCallResult | null = null
  // Report the model of the *last* attempt so the message matches the error shown.
  let lastModel: string | null = candidates[0] ?? null
  for (const model of candidates.slice(0, MAX_DISCOVERY_TRIES)) {
    const result = await callChat(provider, apiKey, model, prompt)
    if (result.ok) return { ...result, model, discovered: true }
    last = result
    lastModel = model
  }
  return {
    ...(last ?? { ok: false, status: 0, latency_ms: 0, detail: 'No discovered model answered.', answer: null }),
    model: lastModel,
    discovered: true,
  }
}
