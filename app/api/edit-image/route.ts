import { microserviceFetch } from '@/lib/usage/internal'
import { beginToolQuota } from '@/lib/usage/quota'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const imageFile = formData.get('image')
  const operation = formData.get('operation')
  const options = formData.get('options')

  if (!imageFile || !(imageFile instanceof File)) {
    return NextResponse.json({ error: 'No valid image file provided' }, { status: 400 })
  }

  const quota = await beginToolQuota(request, 'image-editor')
  if (!quota.ok) return quota.response

  try {
    const forwardFormData = new FormData()
    forwardFormData.append('image', imageFile, imageFile.name)
    if (operation) forwardFormData.append('operation', operation.toString())
    if (options) forwardFormData.append('options', options.toString())

    const response = await microserviceFetch('/edit-image', {
      method: 'POST',
      body: forwardFormData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || 'Image processing failed')
    }

    const blob = await response.blob()
    return quota.apply(new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="edited_${imageFile.name}"`,
      },
    }), { successful: true, fileName: imageFile.name })
  } catch (error) {
    console.error('Image edit API error:', error)
    return quota.apply(NextResponse.json(
      { error: error instanceof Error ? error.message : 'Image processing failed' },
      { status: 500 }
    ))
  }
}
