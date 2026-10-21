import { NextRequest, NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { microserviceFetch } from '@/lib/usage/internal'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const pdfFile = formData.get('pdf') as File

  if (!pdfFile) {
    return NextResponse.json(
      { error: 'No PDF file provided' },
      { status: 400 }
    )
  }

  const quota = await beginToolQuota(request, 'pdf-to-images')
  if (!quota.ok) return quota.response

  const dpi = formData.get('dpi') || '200'
  const format = formData.get('format') || 'png'
  const quality = formData.get('quality') || '95'

  try {
    const forwardFormData = new FormData()
    forwardFormData.append('pdf', pdfFile)
    forwardFormData.append('dpi', dpi)
    forwardFormData.append('format', format)
    forwardFormData.append('quality', quality)

    const response = await microserviceFetch('/convert/pdf-to-images', {
      method: 'POST',
      body: forwardFormData,
    })

    if (!response.ok) {
      let errorMessage = 'Conversion failed'

      try {
        const error = await response.json()
        errorMessage = error?.error || errorMessage
      } catch {
        const errorText = await response.text()
        if (errorText) {
          errorMessage = errorText
        }
      }

      throw new Error(errorMessage)
    }

    const blob = await response.blob()

    return quota.apply(new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="mycloove_images.zip"',
      },
    }), { successful: true, fileName: pdfFile.name })
  } catch (error) {
    console.error('Error:', error)
    return quota.apply(NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to convert PDF to images' },
      { status: 500 }
    ))
  }
}
