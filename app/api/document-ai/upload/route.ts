import { NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { rewriteDocumentAiFileUrl } from '@/lib/usage/internal'
import { brokerAiCall } from '@/lib/ai/broker.ts'

export async function POST(request: Request) {
  const quota = await beginToolQuota(request, 'document-ai')
  if (!quota.ok) return quota.response

  try {
    const incoming = await request.formData()
    let fileName: string | null = null
    for (const value of incoming.values()) {
      if (value instanceof File) { fileName = value.name; break }
    }

    // Uploads carry the embedding config only; the broker falls back to the local
    // model when no embedding provider is configured.
    const result = await brokerAiCall('document_ai_embedding', '/api/document-ai/upload', {
      method: 'POST',
      body: incoming,
    })

    const payload = result.data as Record<string, unknown> | null
    if (!payload) {
      return quota.apply(NextResponse.json({ error: 'Upload failed' }, { status: result.status || 502 }))
    }
    if (typeof payload.doc_id === 'string') {
      payload.pdf_url = rewriteDocumentAiFileUrl(payload.pdf_url, payload.doc_id)
    }
    return quota.apply(NextResponse.json(payload, { status: result.status || 200 }), { successful: result.ok, fileName })
  } catch {
    return quota.apply(NextResponse.json(
      { error: 'Document AI upload service is unavailable' },
      { status: 503 },
    ))
  }
}
