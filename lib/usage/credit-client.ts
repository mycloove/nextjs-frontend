import type { CreditSnapshot } from './credit-types'

const QUOTE_EVENT = 'mycloove:credit-quote'
export const CREDIT_CHANGED_EVENT = 'mycloove:credits-changed'
const POST_TO_TOOL: Record<string, string> = {
  '/api/images-to-pdf': 'image-to-pdf', '/api/image-to-pdf': 'image-to-pdf',
  '/api/analyze-pdf': 'ai-analyzer', '/api/seq-tools': 'fasta-tools',
  '/api/bijoy-convert': 'bijoy-converter', '/api/export/docx': 'pdf-to-markdown',
}

function requestTool(input: string) {
  if (typeof window === 'undefined') return null
  const url = new URL(input, window.location.href)
  if (url.origin !== window.location.origin) return null
  if (url.pathname.startsWith('/api/document-ai/')) return 'document-ai'
  if (url.pathname.startsWith('/api/pdf-editor/')) return 'pdf-editor'
  return POST_TO_TOOL[url.pathname] ?? (/^\/api\/[a-z0-9-]+$/.test(url.pathname) ? url.pathname.slice(5) : null)
}

// A request-scoped quote exchange, not a global balance store. Mounted surfaces
// offer their displayed price; the server alone authorizes and prices the work.
export function creditRequestHeaders(input: string, source?: HeadersInit) {
  const headers = new Headers(source)
  const toolId = requestTool(input)
  if (!toolId || typeof window === 'undefined') return headers
  let quote: CreditSnapshot['prices'][string] | null = null
  window.dispatchEvent(new CustomEvent(QUOTE_EVENT, { detail: { toolId, offer: (value: CreditSnapshot['prices'][string]) => { quote = value } } }))
  const selected = quote as CreditSnapshot['prices'][string] | null
  if (selected) {
    if (!headers.has('X-Credit-Cost')) headers.set('X-Credit-Cost', String(selected.cost))
    if (!headers.has('X-Credit-Price-Version')) headers.set('X-Credit-Price-Version', String(selected.version))
  }
  // Non-HTTPS LAN previews may lack randomUUID. Let the server create the ID
  // rather than breaking an otherwise supported converter before fetch starts.
  if (!headers.has('X-Request-Id') && typeof crypto.randomUUID === 'function') headers.set('X-Request-Id', crypto.randomUUID())
  return headers
}

export function notifyCreditChange() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CREDIT_CHANGED_EVENT))
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(CREDIT_CHANGED_EVENT)
      channel.postMessage('refresh')
      channel.close()
    }
  } catch { /* Optional cross-tab hints can never fail a completed conversion. */ }
}

export function listenCreditQuotes(snapshot: CreditSnapshot | null) {
  if (typeof window === 'undefined' || snapshot?.mode !== 'metered') return () => {}
  const handle = (event: Event) => {
    const detail = (event as CustomEvent<{ toolId: string; offer: (price: CreditSnapshot['prices'][string]) => void }>).detail
    const price = detail && snapshot.prices[detail.toolId]
    if (price && typeof detail.offer === 'function') detail.offer(price)
  }
  window.addEventListener(QUOTE_EVENT, handle)
  return () => window.removeEventListener(QUOTE_EVENT, handle)
}
