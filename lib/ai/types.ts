/**
 * AI provider broker types. These describe what the Next.js server forwards to
 * Flask and what the bench renders. The plaintext provider key is carried only
 * inside a ResolvedAiTarget / AiChainAttempt, which never leaves the server.
 */

export type AiDriver = 'openai_compatible' | 'gemini_native' | 'huggingface'

export type AiFeature = 'document_ai_chat' | 'ai_analyzer_summary' | 'document_ai_embedding'

/** One provider+model+key, already decrypted. Server-side only. */
export type AiTarget = {
  driver: AiDriver
  baseUrl: string
  model: string
  apiKey: string
  /** Embedding vector width when known. Rides in the X-AI-Config header. */
  dim?: number | null
}

/** A target bound to the route that produced it, used to report key health. */
export type AiChainAttempt = AiTarget & {
  feature: AiFeature
  providerId: string
  providerKey: string
  label: string
  keyId: string
}

export type ResolvedAiTarget = {
  chat?: AiChainAttempt
  embedding?: AiChainAttempt
}

/** A masked provider key, safe to render in the bench. */
export type KeyView = {
  id: string
  provider_id: string
  label: string | null
  masked: string
  last4: string | null
  enabled: boolean
  last_error: string | null
  last_used_at: string | null
  cooldown_until: string | null
  created_at: string
}

export type ProviderRouteView = {
  feature: AiFeature
  priority: number
  enabled: boolean
}

/** A provider with its keys (masked) and the feature chains it participates in. */
export type ProviderView = {
  id: string
  key: string
  label: string
  driver: AiDriver
  base_url: string | null
  chat_model: string | null
  embedding_model: string | null
  embedding_dim: number | null
  enabled: boolean
  is_custom: boolean
  sort_order: number
  keys: KeyView[]
  routes: ProviderRouteView[]
  /** Enabled and configured enough to serve a chat call. */
  usable_chat: boolean
  /** Enabled and configured enough to serve an embedding call. */
  usable_embedding: boolean
}

export type FeatureChainView = {
  feature: AiFeature
  provider_ids: string[]
}

/** How the provider-key data key (DEK) is stored. */
export type AiKeyMode = 'kek' | 'unwrapped'

/**
 * The bench-facing state of the keyring. `ready` means provider keys can be
 * encrypted and decrypted on this server; `locked` means they exist but cannot
 * be opened (the wrapping env secret is missing or wrong).
 */
export type KeyringStatus = {
  ready: boolean
  locked: boolean
  mode: AiKeyMode | null
  message: string
}
