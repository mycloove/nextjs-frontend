import { microserviceFetch } from '@/lib/usage/internal'
import { beginToolQuota } from '@/lib/usage/quota'
import { NextRequest, NextResponse } from 'next/server'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export async function POST(request: NextRequest) {
  const incoming = await request.formData()
  const markdown = incoming.get('markdown')
  const filename = incoming.get('filename')
  if (typeof markdown !== 'string' || !markdown.trim()) {
    return NextResponse.json({ error: 'No Markdown content provided' }, { status: 400 })
  }

  const quota = await beginToolQuota(request, 'pdf-to-markdown')
  if (!quota.ok) return quota.response

  try {
    const forward = new FormData()
    forward.append('markdown', markdown)
    if (typeof filename === 'string') forward.append('filename', filename)
    for (const asset of incoming.getAll('assets')) {
      if (asset instanceof File) forward.append('assets', asset, asset.name)
    }

    const response = await microserviceFetch('/api/export/docx', {
      method: 'POST',
      body: forward,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => null)
      return quota.apply(NextResponse.json(
        { error: error?.error || 'DOCX export failed' },
        { status: response.status },
      ))
    }

    return quota.apply(new NextResponse(await response.arrayBuffer(), {
      headers: {
        'Content-Type': DOCX_MIME,
        'Content-Disposition': response.headers.get('content-disposition') || 'attachment; filename="mycloove_document.docx"',
        'Cache-Control': 'no-store',
      },
    }), { successful: true, fileName: typeof filename === 'string' ? filename : null })
  } catch (error) {
    console.error('DOCX export proxy failed:', error)
    return quota.apply(NextResponse.json({ error: 'DOCX export service is unavailable' }, { status: 503 }))
  }
}
