import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { microserviceFetch, microserviceUrl } from '@/lib/usage/internal'

/**
 * POST /api/pdf-to-images — thin validating proxy (CLAUDE.md §5) to the Flask
 * engine at /convert/pdf-to-images (pdf-microservice/features/pdf_to_images.py).
 *
 * The previous handler dropped the `pageRange` the UI sent — so "pages 3–5"
 * rendered the whole document — forwarded unvalidated options, had no
 * timeout, and collapsed every upstream failure into a 500. The page-range
 * grammar is validated by the engine (it needs the real page count); this
 * route checks the request's shape so a malformed one is refused before a
 * conversion is charged.
 */

const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 180_000
const DPI_MIN = 36
const DPI_MAX = 600
const FORMATS = new Set(['png', 'jpg', 'jpeg'])
const MAX_RANGE_LENGTH = 500

/** Engine facts the UI shows; anything else upstream sends stays upstream. */
const PASS_THROUGH_HEADERS = ['X-Page-Count', 'X-Total-Pages', 'X-Dpi', 'X-Image-Format']

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

function text(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function readOptions(formData: FormData) {
  const dpiText = text(formData, 'dpi') || '200'
  const dpi = /^\d+$/.test(dpiText) ? Number(dpiText) : Number.NaN
  if (!(dpi >= DPI_MIN && dpi <= DPI_MAX)) {
    throw new RequestValidationError(`Resolution must be between ${DPI_MIN} and ${DPI_MAX} DPI.`, 'invalid_dpi')
  }
  const format = (text(formData, 'format') || 'png').toLowerCase()
  if (!FORMATS.has(format)) throw new RequestValidationError('Image format must be PNG or JPG.', 'invalid_format')
  const qualityText = text(formData, 'quality') || '95'
  const quality = /^\d+$/.test(qualityText) ? Number(qualityText) : Number.NaN
  if (!(quality >= 1 && quality <= 100)) {
    throw new RequestValidationError('JPEG quality must be between 1 and 100.', 'invalid_quality')
  }
  const pageRange = text(formData, 'pageRange')
  if (pageRange.length > MAX_RANGE_LENGTH) {
    throw new RequestValidationError('That page range is too long.', 'invalid_range')
  }
  return { dpi: String(dpi), format, quality: String(quality), pageRange }
}

function downloadName(fileName: string) {
  const stem = fileName.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'document'
  const name = `mycloove_${stem}_images.zip`
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
    if (!looksPdf) throw new RequestValidationError('Only PDF files can be converted to images.', 'unsupported_file_type', 415)
    const maxFileBytes = positiveEnv('PDF_TO_IMAGES_MAX_FILE_BYTES', DEFAULT_MAX_FILE_BYTES)
    if (file.size > maxFileBytes) {
      throw new RequestValidationError(
        `This PDF is larger than ${Math.round(maxFileBytes / 1024 / 1024)} MB.`,
        'file_too_large',
        413,
      )
    }
    const options = readOptions(formData)

    quota = await beginToolQuota(request, 'pdf-to-images', formData)
    if (!quota.ok) return quota.response

    const forward = new FormData()
    forward.append('pdf', file, file.name)
    forward.append('dpi', options.dpi)
    forward.append('format', options.format)
    forward.append('quality', options.quality)
    if (options.pageRange) forward.append('pageRange', options.pageRange)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), positiveEnv('PDF_TO_IMAGES_TIMEOUT_MS', DEFAULT_TIMEOUT_MS))
    let upstream: Response
    try {
      upstream = await microserviceFetch('/convert/pdf-to-images', {
        method: 'POST',
        body: forward,
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'X-Request-Id': requestId },
      })
    } catch (error) {
      const timedOut = controller.signal.aborted
      if (!timedOut) console.error('PDF to Images upstream unavailable', { requestId, url: microserviceUrl(), error })
      return quota.apply(timedOut
        ? errorResponse('Rendering took too long. Try a lower resolution or a page range.', 'upstream_timeout', 504, requestId)
        : errorResponse('The image service is unavailable right now. Please try again shortly.', 'upstream_unavailable', 502, requestId))
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
      return quota.apply(errorResponse(
        body.error || 'The pages could not be rendered. Please try again.',
        body.code || 'operation_failed',
        upstream.status >= 500 ? 502 : upstream.status,
        requestId,
      ))
    }

    const headers = new Headers({
      'Content-Type': 'application/zip',
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
      console.error('PDF to Images failed', { requestId, error })
      failure = errorResponse('The pages could not be rendered. Please try again.', 'operation_failed', 500, requestId)
    }
    return quota?.ok ? quota.apply(failure) : failure
  }
}
