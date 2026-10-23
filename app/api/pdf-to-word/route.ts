import { NextRequest, NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { microserviceFetch, microserviceUrl } from '@/lib/usage/internal'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const pdfFile = formData.get('pdf') as File

  if (!pdfFile) {
    return NextResponse.json(
      { error: 'No PDF file provided' },
      { status: 400 }
    )
  }

  const quota = await beginToolQuota(request, 'pdf-to-word', formData)
  if (!quota.ok) return quota.response

  try {
    const forwardFormData = new FormData()
    forwardFormData.append('pdf', pdfFile)

    const response = await microserviceFetch('/convert/pdf-to-word', {
      method: 'POST',
      body: forwardFormData,
    })

    if (!response.ok) {
      let message = 'Conversion failed'

      try {
        const error = await response.json()
        message = error.error || message
      } catch {
        const errorText = await response.text()
        if (errorText) {
          message = errorText
        }
      }

      throw new Error(message)
    }

    const blob = await response.blob()

    return quota.apply(new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': 'attachment; filename="mycloove_converted.docx"',
      },
    }), { successful: true, fileName: pdfFile.name })
  } catch (error) {
    console.error('Error:', error)

    const message = error instanceof Error ? error.message : 'Failed to convert PDF to Word'
    const status = message.includes('fetch failed') || message.includes('ECONNREFUSED')
      ? 503
      : 500

    return quota.apply(NextResponse.json(
      {
        error: status === 503
          ? `PDF microservice is unavailable at ${microserviceUrl()}. Start the Flask backend and try again.`
          : message,
      },
      { status }
    ))
  }
}
