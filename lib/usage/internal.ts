/**
 * Flask stays a private processor. The browser talks only to Next.js `/api/*`.
 * When `PDF_SERVICE_INTERNAL_KEY` is set, a copied curl to :5001 is rejected.
 */
export function microserviceUrl(): string {
  return (process.env.PDF_MICROSERVICE_URL || 'http://localhost:5001').replace(/\/$/, '')
}

/**
 * `aiConfig` is the base64url provider config the AI broker resolves. It rides
 * the same trusted server-to-server channel as the internal key, and is only
 * ever set from `lib/ai/broker.ts` — never from anything the browser sent.
 * Omitting it (every existing caller) is the legacy env path.
 */
export function withMicroserviceHeaders(headers?: HeadersInit, aiConfig?: string | null): Headers {
  const merged = new Headers(headers)
  const key = process.env.PDF_SERVICE_INTERNAL_KEY?.trim()
  if (key) merged.set('X-Pdf-Service-Key', key)
  if (aiConfig) merged.set('X-AI-Config', aiConfig)
  return merged
}

export function microserviceFetch(path: string, init: RequestInit = {}, aiConfig?: string | null): Promise<Response> {
  const url = path.startsWith('http') ? path : `${microserviceUrl()}${path.startsWith('/') ? path : `/${path}`}`
  return fetch(url, {
    ...init,
    headers: withMicroserviceHeaders(init.headers, aiConfig),
  })
}

export function rewriteDocumentAiFileUrl(pdfUrl: unknown, docId: string): string {
  if (typeof pdfUrl === 'string') {
    const match = pdfUrl.match(/\/uploads\/([A-Za-z0-9_-]{1,128}\.pdf)(?:\?|$)/)
    if (match) return `/api/document-ai/files/${match[1]}`
  }
  return `/api/document-ai/files/${docId}.pdf`
}
