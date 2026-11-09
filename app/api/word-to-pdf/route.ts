import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { microserviceFetch, microserviceUrl } from '@/lib/usage/internal'

/**
 * POST /api/word-to-pdf — thin validating proxy (CLAUDE.md §5) to the Flask
 * engine at /convert/word-to-pdf (pdf-microservice/features/word_to_pdf.py).
 *
 * The previous handler charged a conversion before validating anything, had
 * no timeout, named every download "mycloove_converted.pdf" and turned every
 * upstream failure into a 500. The engine decides the real format from the
 * file's bytes; this route only checks the request's shape and limits.
 */

export const runtime = 'nodejs'

const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024
// The engine's own LibreOffice timeout is 120 s; leave room for upload + verify.
const DEFAULT_TIMEOUT_MS = 150_000
const ACCEPTED_EXTENSIONS = ['.docx', '.doc', '.odt', '.rtf']

const PASS_THROUGH_HEADERS = ['X-Page-Count', 'X-Source-Format']

class RequestValidationError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message)
    this.name = 'RequestValidationError'
  }
}

function positiveEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function errorResponse(error: string, code: string, status: number, requestId: string) {
  return NextResponse.json(
    { error, code, request_id: requestId },
    { status, headers: { 'X-Request-Id': requestId } },
  )
}

function downloadName(fileName: string) {
  const stem = fileName.replace(/\.(docx|doc|odt|rtf)$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'document'
  const name = `mycloove_${stem}.pdf`
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  let quota: Awaited<ReturnType<typeof beginToolQuota>> | undefined
  try {
    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      throw new RequestValidationError('The upload could not be read. Please try again.', 'invalid_form')
    }

    const file = formData.get('word')
    if (!(file instanceof File) || file.size === 0) {
      throw new RequestValidationError('Choose a Word document to convert.', 'missing_file')
    }
    const lowerName = file.name.toLowerCase()
    if (!ACCEPTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
      throw new RequestValidationError('Upload a .docx, .doc, .odt or .rtf document.', 'unsupported_file_type', 415)
    }
    const maxFileBytes = positiveEnv('WORD_TO_PDF_MAX_FILE_BYTES', DEFAULT_MAX_FILE_BYTES)
    if (file.size > maxFileBytes) {
      throw new RequestValidationError(
        `This document is larger than ${Math.round(maxFileBytes / 1024 / 1024)} MB.`,
        'file_too_large',
        413,
      )
    }

    quota = await beginToolQuota(request, 'word-to-pdf', formData)
    if (!quota.ok) return quota.response

    const forward = new FormData()
    forward.append('word', file, file.name)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), positiveEnv('WORD_TO_PDF_TIMEOUT_MS', DEFAULT_TIMEOUT_MS))
    let upstream: Response
    try {
      upstream = await microserviceFetch('/convert/word-to-pdf', {
        method: 'POST',
        body: forward,
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'X-Request-Id': requestId },
      })
    } catch (error) {
      const timedOut = controller.signal.aborted
      if (!timedOut) console.error('Word to PDF upstream unavailable', { requestId, url: microserviceUrl(), error })
      return quota.apply(timedOut
        ? errorResponse('This document took too long to convert. Please try again.', 'upstream_timeout', 504, requestId)
        : errorResponse('The conversion service is unavailable right now. Please try again shortly.', 'upstream_unavailable', 502, requestId))
    } finally {
      clearTimeout(timer)
    }

    if (!upstream.ok) {
      let body: { error?: string; code?: string } = {}
      try {
        body = await upstream.json()
      } catch {
        // non-JSON upstream body: fall through to the generic message
      }
      // 503/504 from the engine are meaningful to the user (engine down, too
      // slow); any other 5xx is an internal failure and becomes a 502.
      const status = upstream.status === 503 || upstream.status === 504
        ? upstream.status
        : upstream.status >= 500 ? 502 : upstream.status
      return quota.apply(errorResponse(
        body.error || 'The document could not be converted. Please try again.',
        body.code || 'operation_failed',
        status,
        requestId,
      ))
    }

    const headers = new Headers({
      'Content-Type': 'application/pdf',
      'Content-Disposition': downloadName(file.name),
      'X-Request-Id': requestId,
    })
    for (const name of PASS_THROUGH_HEADERS) {
      const value = upstream.headers.get(name)
      if (value) headers.set(name, value)
    }
    const bytes = new Uint8Array(await upstream.arrayBuffer())
    return quota.apply(new NextResponse(bytes, { status: 200, headers }), {
      successful: true,
      fileName: file.name,
    })
  } catch (error) {
    let failure: NextResponse
    if (error instanceof RequestValidationError) {
      failure = errorResponse(error.message, error.code, error.status, requestId)
    } else {
      console.error('Word to PDF failed', { requestId, error })
      failure = errorResponse('The document could not be converted. Please try again.', 'operation_failed', 500, requestId)
    }
    return quota?.ok ? quota.apply(failure) : failure
  }
}
