import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { microserviceFetch, microserviceUrl } from '@/lib/usage/internal'

/**
 * POST /api/pdf-to-word — thin validating proxy (CLAUDE.md §5) to the Flask
 * engine at /convert/pdf-to-word (pdf-microservice/features/pdf_to_word.py).
 *
 * The previous handler charged a conversion before validating anything, had
 * no timeout (a long scan hung the request), named every download
 * "mycloove_converted.docx", collapsed the engine's errors into 500s and
 * showed users the internal backend URL. The engine now names each failure
 * (encrypted_pdf, unreadable_pdf, scan_too_long, …); this route keeps those
 * codes and adds its own for limits and transport.
 */

export const runtime = 'nodejs'

const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024
// The backend's own budget is gunicorn's 300 s; a scanned PDF of the engine's
// page limit reads in well under that. Stop just short so the user hears from
// us, not from a dropped connection.
const DEFAULT_TIMEOUT_MS = 280_000

/** Engine facts the UI reports; anything else upstream sends stays upstream. */
const PASS_THROUGH_HEADERS = ['X-Conversion-Method', 'X-Page-Count', 'X-Ocr-Tables']

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
  const stem = fileName.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'document'
  const name = `mycloove_${stem}.docx`
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

    const file = formData.get('pdf')
    if (!(file instanceof File) || file.size === 0) {
      throw new RequestValidationError('Choose a PDF to convert.', 'missing_file')
    }
    const looksPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!looksPdf) throw new RequestValidationError('Only PDF files can be converted to Word.', 'unsupported_file_type', 415)
    const maxFileBytes = positiveEnv('PDF_TO_WORD_MAX_FILE_BYTES', DEFAULT_MAX_FILE_BYTES)
    if (file.size > maxFileBytes) {
      throw new RequestValidationError(
        `This PDF is larger than ${Math.round(maxFileBytes / 1024 / 1024)} MB.`,
        'file_too_large',
        413,
      )
    }

    quota = await beginToolQuota(request, 'pdf-to-word', formData)
    if (!quota.ok) return quota.response

    const forward = new FormData()
    forward.append('pdf', file, file.name)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), positiveEnv('PDF_TO_WORD_TIMEOUT_MS', DEFAULT_TIMEOUT_MS))
    let upstream: Response
    try {
      upstream = await microserviceFetch('/convert/pdf-to-word', {
        method: 'POST',
        body: forward,
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'X-Request-Id': requestId },
      })
    } catch (error) {
      const timedOut = controller.signal.aborted
      // The backend address is for the log, never for the user.
      if (!timedOut) console.error('PDF to Word upstream unavailable', { requestId, url: microserviceUrl(), error })
      return quota.apply(timedOut
        ? errorResponse('This PDF took too long to convert. If it is a long scan, split it into parts and convert each one.', 'upstream_timeout', 504, requestId)
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
      // 503/504 from the engine (OCR unavailable / too slow) mean something
      // to the user; any other 5xx is an internal failure and becomes a 502.
      const status = upstream.status === 503 || upstream.status === 504
        ? upstream.status
        : upstream.status >= 500 ? 502 : upstream.status
      return quota.apply(errorResponse(
        body.error || 'This PDF could not be converted. Please try again.',
        body.code || 'operation_failed',
        status,
        requestId,
      ))
    }

    const headers = new Headers({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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
      console.error('PDF to Word failed', { requestId, error })
      failure = errorResponse('This PDF could not be converted. Please try again.', 'operation_failed', 500, requestId)
    }
    return quota?.ok ? quota.apply(failure) : failure
  }
}
