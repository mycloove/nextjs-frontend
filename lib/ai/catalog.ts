import type { AiDriver, AiFeature } from './types.ts'

/**
 * Seeded providers and default feature chains.
 *
 * These mirror the free tiers the product targets. Everything except `key` is
 * admin-editable once seeded, because free model names drift and a rename must
 * not need a redeploy. `key` is the stable slug the desk and the seeder match
 * on; it never changes.
 */
export type AiProviderSeed = {
  key: string
  label: string
  driver: AiDriver
  baseUrl: string
  chatModel: string | null
  embeddingModel: string | null
  embeddingDim: number | null
  sortOrder: number
}

export const AI_PROVIDER_CATALOG: readonly AiProviderSeed[] = [
  {
    key: 'google',
    label: 'Google Gemini',
    driver: 'gemini_native',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    chatModel: 'gemini-2.5-flash',
    embeddingModel: 'text-embedding-004',
    embeddingDim: 768,
    sortOrder: 10,
  },
  {
    key: 'groq',
    label: 'Groq',
    driver: 'openai_compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    chatModel: 'llama-3.3-70b-versatile',
    embeddingModel: null,
    embeddingDim: null,
    sortOrder: 20,
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    driver: 'openai_compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    chatModel: 'meta-llama/llama-3.3-70b-instruct:free',
    embeddingModel: null,
    embeddingDim: null,
    sortOrder: 30,
  },
  {
    key: 'cerebras',
    label: 'Cerebras',
    driver: 'openai_compatible',
    baseUrl: 'https://api.cerebras.ai/v1',
    chatModel: 'llama-3.3-70b',
    embeddingModel: null,
    embeddingDim: null,
    sortOrder: 40,
  },
  {
    key: 'mistral',
    label: 'Mistral',
    driver: 'openai_compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    chatModel: 'mistral-small-latest',
    embeddingModel: 'mistral-embed',
    embeddingDim: 1024,
    sortOrder: 50,
  },
  {
    key: 'huggingface',
    label: 'Hugging Face',
    driver: 'huggingface',
    baseUrl: 'https://router.huggingface.co/v1',
    chatModel: 'meta-llama/Llama-3.3-70B-Instruct',
    embeddingModel: null,
    embeddingDim: null,
    sortOrder: 60,
  },
  {
    key: 'zai',
    label: 'Z.AI (GLM)',
    driver: 'openai_compatible',
    // OpenAI-compatible endpoint. The GLM flash models are listed at $0 input
    // and output, so this is a zero-cost chat provider. Model is editable in the
    // bench because free tiers rename.
    baseUrl: 'https://api.z.ai/api/paas/v4',
    chatModel: 'glm-4.5-flash',
    embeddingModel: null,
    embeddingDim: null,
    sortOrder: 70,
  },
  {
    key: 'cloudflare',
    label: 'Cloudflare Workers AI',
    driver: 'openai_compatible',
    // Workers AI's OpenAI-compatible API is account-scoped: replace
    // YOUR_CLOUDFLARE_ACCOUNT_ID with the account id from the Cloudflare
    // dashboard before testing (edit it in the bench). Free daily allocation.
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/YOUR_CLOUDFLARE_ACCOUNT_ID/ai/v1',
    chatModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    embeddingModel: null,
    embeddingDim: null,
    sortOrder: 80,
  },
]

export const AI_ROUTE_DEFAULTS: readonly { feature: AiFeature; providerKeys: readonly string[] }[] = [
  { feature: 'document_ai_chat', providerKeys: ['google', 'groq', 'openrouter'] },
  { feature: 'ai_analyzer_summary', providerKeys: ['groq', 'google'] },
  { feature: 'document_ai_embedding', providerKeys: ['google'] },
]

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  document_ai_chat: 'Document AI chat, summary, MCQ and bullets',
  ai_analyzer_summary: 'AI Analyzer summary',
  document_ai_embedding: 'Document AI embeddings (single provider only)',
}

export const AI_FEATURES: readonly AiFeature[] = [
  'document_ai_chat',
  'ai_analyzer_summary',
  'document_ai_embedding',
]

export function isAiDriver(value: unknown): value is AiDriver {
  return value === 'openai_compatible' || value === 'gemini_native' || value === 'huggingface'
}

export function isAiFeature(value: unknown): value is AiFeature {
  return value === 'document_ai_chat' || value === 'ai_analyzer_summary' || value === 'document_ai_embedding'
}
