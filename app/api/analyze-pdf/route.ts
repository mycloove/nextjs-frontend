import { NextRequest, NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { brokerAiCall } from '@/lib/ai/broker.ts'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const pdfFile = formData.get('pdf') as File
  const analysisMode = (formData.get('analysis_mode') as string) || 'minimal'

  if (!pdfFile) {
    return NextResponse.json({ error: 'No PDF file provided' }, { status: 400 })
  }

  const quota = await beginToolQuota(request, 'ai-analyzer', formData)
  if (!quota.ok) return quota.response

  try {
    const forwardFormData = new FormData()
    forwardFormData.append('pdf', pdfFile)
    forwardFormData.append('analysis_mode', analysisMode)

    const result = await brokerAiCall('ai_analyzer_summary', '/analyze-pdf', {
      method: 'POST',
      body: forwardFormData,
    })

    if (!result.ok) {
      const data = result.data as Record<string, unknown> | null
      const message = (data && typeof data.error === 'string' && data.error) || 'Analysis failed'
      throw new Error(message)
    }

    return quota.apply(NextResponse.json(result.data), { successful: true, fileName: pdfFile.name })
  } catch (error) {
    console.error('Analysis API error:', error)
    return quota.apply(NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to analyze document' },
      { status: 500 }
    ))
  }
}
