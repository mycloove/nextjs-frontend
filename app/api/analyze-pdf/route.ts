import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { brokerAiCall } from '@/lib/ai/broker.ts'

/**
 * Thin validating proxy for the AI Analyzer (CLAUDE.md §5; the reference is
 * app/api/pdf-to-markdown/route.ts). Validate, forward through the AI broker,
 * and pass the engine's named refusals through with their own status and code
 * — a password-protected PDF is a 400 `encrypted_pdf`, a scan with no
 * readable text a 422 `no_text` — instead of flattening every failure into a
 * 500 the user cannot act on. No analysis logic lives here.
 *
 * Quota is claimed only after the request is valid, and a credit is spent only
 * on a delivered report.
 */

const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024
const ALLOWED_MODES = new Set(['minimal', 'elaborate'])
const PDF_MIME_TYPES = new Set(['application/pdf', 'application/x-pdf'])

class RequestValidationError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message)
    this.name = 'RequestValidationError'
  }
}

function parsePositiveInteger(rawValue: string | undefined, fallback: number) {
  if (!rawValue) return fallback
  const value = Number.parseInt(rawValue, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function jsonError(error: string, code: string, status: number, requestId: string) {
  return NextResponse.json(
    { error, code, request_id: requestId },
    { status, headers: { 'X-Request-Id': requestId } },
  )
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()

  let formData: FormData
  let pdfFile: File
  let analysisMode: string
  try {
    formData = await request.formData()
    const candidate = formData.get('pdf')
    if (!(candidate instanceof File) || candidate.size === 0) {
      throw new RequestValidationError('No PDF file provided.', 'missing_file')
    }
    if (!PDF_MIME_TYPES.has(candidate.type.toLowerCase()) && !candidate.name.toLowerCase().endsWith('.pdf')) {
      throw new RequestValidationError('Only PDF files can be analyzed.', 'unsupported_file_type', 415)
    }
    const maxBytes = parsePositiveInteger(process.env.AI_ANALYZER_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES)
    if (candidate.size > maxBytes) {
      throw new RequestValidationError(
        `The PDF is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`, 'file_too_large', 413,
      )
    }
    const mode = formData.get('analysis_mode')
    analysisMode = typeof mode === 'string' && ALLOWED_MODES.has(mode) ? mode : 'minimal'
    pdfFile = candidate
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return jsonError(error.message, error.code, error.status, requestId)
    }
    return jsonError('The upload could not be read.', 'invalid_form', 400, requestId)
  }

  const quota = await beginToolQuota(request, 'ai-analyzer', formData)
  if (!quota.ok) return quota.response

  const forward = new FormData()
  forward.append('pdf', pdfFile)
  forward.append('analysis_mode', analysisMode)

  try {
    const result = await brokerAiCall('ai_analyzer_summary', '/analyze-pdf', {
      method: 'POST',
      body: forward,
      headers: { 'X-Request-Id': requestId },
    })

    if (result.transportFailed) {
      return quota.apply(jsonError(
        'The analysis service is unavailable. Please try again shortly.', 'upstream_unavailable', 502, requestId,
      ))
    }
    if (!result.ok) {
      const data = (result.data ?? {}) as Record<string, unknown>
      const message = typeof data.error === 'string' && data.error.trim()
        ? data.error
        : 'The analysis could not be completed. Please try again.'
      // A provider failure that survived the whole chain is an upstream fault,
      // not a fact about the user's PDF.
      const code = typeof data.code === 'string' ? data.code : data.ai_error === true ? 'ai_unavailable' : 'analysis_failed'
      const status = result.status >= 400 && result.status < 600 ? result.status : 502
      return quota.apply(jsonError(message, code, status, requestId))
    }

    const response = NextResponse.json(result.data, { headers: { 'X-Request-Id': requestId } })
    return quota.apply(response, { successful: true, fileName: pdfFile.name })
  } catch (error) {
    console.error('Analysis API error:', error)
    return quota.apply(jsonError(
      'The analysis could not be completed. Please try again.', 'analysis_failed', 500, requestId,
    ))
  }
}
