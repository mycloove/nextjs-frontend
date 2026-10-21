import { NextRequest, NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { microserviceFetch } from '@/lib/usage/internal'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const tasksJson = formData.get('tasks') as string
  if (!tasksJson) {
    return NextResponse.json({ error: 'No tasks provided' }, { status: 400 })
  }

  const quota = await beginToolQuota(request, 'batch-process')
  if (!quota.ok) return quota.response

  try {
    const forwardFormData = new FormData()
    forwardFormData.append('tasks', tasksJson)

    let fileName: string | null = null
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('file_') && value instanceof File) {
        forwardFormData.append(key, value)
        if (!fileName) fileName = value.name
      }
    }

    const response = await microserviceFetch('/batch-process', {
      method: 'POST',
      body: forwardFormData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || 'Batch processing failed')
    }

    const blob = await response.blob()
    return quota.apply(new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="mycloove_batch_results.zip"',
      },
    }), { successful: true, fileName })
  } catch (error) {
    console.error('Batch API error:', error)
    return quota.apply(NextResponse.json(
      { error: error instanceof Error ? error.message : 'Batch processing failed' },
      { status: 500 }
    ))
  }
}
