import { NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { rewriteDocumentAiFileUrl } from '@/lib/usage/internal'
import { brokerAiCall } from '@/lib/ai/broker.ts'

export async function POST(request: Request) {
  let incoming: FormData
  try { incoming = await request.formData() }
  catch { return NextResponse.json({ error: 'Valid multipart form data is required.', code: 'invalid_request' }, { status: 400 }) }
  const file = incoming.get('file') ?? incoming.get('pdf')
  if (!(file instanceof File) || !file.size || file.size > 100 * 1024 * 1024) {
    return NextResponse.json({ error: 'A nonempty document of at most 100 MB is required.', code: 'invalid_file' }, { status: 400 })
  }
  const quota = await beginToolQuota(request, 'document-ai', incoming)
  if (!quota.ok) return quota.response

  try {
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
    return quota.apply(NextResponse.json(payload, { status: result.status || 200 }), { successful: result.ok && typeof payload.doc_id === 'string' && !!payload.doc_id, fileName })
  } catch {
    return quota.apply(NextResponse.json(
      { error: 'Document AI upload service is unavailable' },
      { status: 503 },
    ))
  }
}
