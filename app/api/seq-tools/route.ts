import { NextRequest, NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { microserviceFetch } from '@/lib/usage/internal'

export async function POST(request: NextRequest) {
  const url = new URL(request.url)
  const action = url.searchParams.get('action') || 'convert'
  const formData = await request.formData()
  const file = formData.get('seq_file') as File
  const targetFormat = (formData.get('target_format') as string) || (formData.get('output_format') as string) || 'mega'

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  let endpoint = ''
  if (action === 'analyze') {
    endpoint = '/analyze/seq'
  } else if (action === 'convert') {
    endpoint = '/convert/seq'
  } else if (action === 'chunk') {
    endpoint = '/convert/seq/chunk'
  } else if (action === 'chunks-zip') {
    endpoint = '/convert/seq/chunks/zip'
  } else if (action === 'export') {
    endpoint = '/export/seq'
  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const quota = await beginToolQuota(request, 'fasta-tools')
  if (!quota.ok) return quota.response

  try {
    const forwardFormData = new FormData()
    forwardFormData.append('seq_file', file)
    if (action === 'convert' || action === 'chunk' || action === 'chunks-zip') {
      forwardFormData.append('target_format', targetFormat)
    }
    if (action === 'chunk') {
      const start = formData.get('start') as string
      const end = formData.get('end') as string
      if (start) forwardFormData.append('start', start)
      if (end) forwardFormData.append('end', end)
    }
    if (action === 'chunks-zip') {
      const chunkSize = formData.get('chunk_size') as string || '2000'
      forwardFormData.append('chunk_size', chunkSize)
    }
    if (action === 'export') {
      const format = (formData.get('format') as string) || (formData.get('report_format') as string) || 'txt'
      const maxSeq = formData.get('max_seq') as string || '1000'
      const start = formData.get('start') as string
      const end = formData.get('end') as string
      const all = formData.get('all') as string
      const pdfMode = (formData.get('pdf_mode') as string) || 'regular'
      forwardFormData.append('format', format)
      forwardFormData.append('max_seq', maxSeq)
      if (format === 'pdf') forwardFormData.append('pdf_mode', pdfMode)
      if (start) forwardFormData.append('start', start)
      if (end) forwardFormData.append('end', end)
      if (all) forwardFormData.append('all', all)
    }

    const response = await microserviceFetch(endpoint, {
      method: 'POST',
      body: forwardFormData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || 'Request failed')
    }

    if (action === 'analyze') {
      const data = await response.json()
      return quota.apply(NextResponse.json(data), { successful: true, fileName: file.name })
    }

    const blob = await response.blob()
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const contentDisposition = response.headers.get('content-disposition') || 'attachment; filename="mycloove_download"'
    return quota.apply(new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': contentDisposition,
      },
    }), { successful: true, fileName: file.name })
  } catch (error) {
    console.error('Seq API error:', error)
    return quota.apply(NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process sequence file' },
      { status: 500 }
    ))
  }
}
