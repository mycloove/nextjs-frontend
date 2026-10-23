import { NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { microserviceFetch } from '@/lib/usage/internal'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const formData = await request.formData()
  const wordFile = formData.get('word')

  if (!wordFile || typeof wordFile === 'string') {
    return NextResponse.json({ error: 'No Word file provided' }, { status: 400 })
  }

  const quota = await beginToolQuota(request, 'word-to-pdf', formData)
  if (!quota.ok) return quota.response

  try {
    const forwardFormData = new FormData()
    forwardFormData.append('word', wordFile, wordFile.name)

    const response = await microserviceFetch('/convert/word-to-pdf', {
      method: 'POST',
      body: forwardFormData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      let message = errorText || 'Conversion failed'
      try {
        const parsed = JSON.parse(errorText)
        if (typeof parsed?.error === 'string' && parsed.error.trim()) message = parsed.error
      } catch {
        // Not JSON — keep the raw text.
      }
      throw new Error(message)
    }

    const blob = await response.blob()
    return quota.apply(new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="mycloove_converted.pdf"',
      },
    }), { successful: true, fileName: wordFile.name })
  } catch (error) {
    return quota.apply(NextResponse.json(
      { error: error instanceof Error ? error.message : 'Conversion failed' },
      { status: 500 }
    ))
  }
}
