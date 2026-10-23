import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { microserviceFetch } from '@/lib/usage/internal'

/**
 * Thin validating proxy for the OCR microservice route — the §5 pattern
 * (app/api/pdf-to-markdown/route.ts is the reference implementation).
 * Validate, forward with a timeout, map failures to coded bodies; all
 * reading logic lives in pdf-microservice/features/image_to_text.py.
 *
 * Quota is claimed only after the upload passes validation.
 */

const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 150_000
const ALLOWED_LANGUAGES = new Set(['auto', 'eng', 'ben', 'eng+ben'])
const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
])
const IMAGE_EXTENSIONS = ['.jpeg', '.jpg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff']

type ErrorBody = {
  error: string
  code?: string
  request_id: string
}

class RequestValidationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'RequestValidationError'
  }
}

function parsePositiveInteger(rawValue: string | undefined, fallback: number) {
  if (!rawValue) return fallback

  const value = Number.parseInt(rawValue, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function isImageFile(file: File) {
  const mime = file.type.toLowerCase()
  if (IMAGE_MIME_TYPES.has(mime)) return true
  // Browsers sometimes send an empty or generic type for unusual formats;
  // the extension is the second signal, and the microservice re-validates
  // by actually decoding the bytes — this gate is UX, not security.
  const name = file.name.toLowerCase()
  return IMAGE_EXTENSIONS.some(ext => name.endsWith(ext))
}

function jsonError(body: ErrorBody, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'X-Request-Id': body.request_id },
  })
}

async function readUpstreamError(response: Response) {
  const contentType = response.headers.get('content-type') || ''
  const text = (await response.text()).trim().slice(0, 500)

  if (contentType.includes('application/json')) {
    try {
      const body = JSON.parse(text) as { error?: unknown; code?: unknown }
      return {
        error: typeof body.error === 'string' && body.error.trim()
          ? body.error
          : `OCR service returned HTTP ${response.status}`,
        code: typeof body.code === 'string' ? body.code : undefined,
      }
    } catch {
      // Fall through to the already-bounded raw response.
    }
  }

  if (contentType.includes('text/html')) {
    return {
      error: `OCR service returned HTTP ${response.status}`,
      code: undefined,
    }
  }

  return {
    error: text || `OCR service returned HTTP ${response.status}`,
    code: undefined,
  }
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  let quota: Awaited<ReturnType<typeof beginToolQuota>> | undefined

  try {
    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      throw new RequestValidationError('Invalid multipart form data', 'invalid_multipart_form')
    }

    const filePart = formData.get('image')
    if (!(filePart instanceof File)) {
      throw new RequestValidationError('No image file provided', 'image_required')
    }

    if (!filePart.size) {
      throw new RequestValidationError('Empty image file', 'empty_image')
    }

    if (!isImageFile(filePart)) {
      throw new RequestValidationError(
        'Unsupported file type; upload an image (JPG, PNG, WEBP, GIF, BMP or TIFF)',
        'unsupported_file_type',
        415,
      )
    }

    const maxFileBytes = parsePositiveInteger(
      process.env.IMAGE_TO_TEXT_MAX_FILE_BYTES,
      DEFAULT_MAX_FILE_BYTES,
    )
    if (filePart.size > maxFileBytes) {
      throw new RequestValidationError(
        `Image exceeds the ${Math.floor(maxFileBytes / (1024 * 1024))} MB upload limit`,
        'file_too_large',
        413,
      )
    }

    const language = (formData.get('language') as string | null)?.trim().toLowerCase() || 'auto'
    if (!ALLOWED_LANGUAGES.has(language)) {
      throw new RequestValidationError('Invalid language option', 'invalid_language')
    }

    quota = await beginToolQuota(request, 'image-to-text', formData)
    if (!quota.ok) return quota.response

    const forwardFormData = new FormData()
    forwardFormData.append('image', filePart, filePart.name)
    forwardFormData.append('language', language)
    // The reader view renders the geometry-only layout/tables/fields extras,
    // so this tool always asks for them. Forwarded as a fixed opt-in flag; the
    // microservice default is unchanged for every other caller.
    forwardFormData.append('structure', '1')

    // OCR of a large photographed page legitimately takes tens of seconds
    // (preprocessing + LSTM pass), so the budget here is deliberately
    // looser than the pure-converter routes.
    const timeoutMs = parsePositiveInteger(
      process.env.IMAGE_TO_TEXT_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
    )
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response
    try {
      response = await microserviceFetch('/convert/image-to-text', {
        method: 'POST',
        body: forwardFormData,
        headers: { 'X-Request-Id': requestId },
        cache: 'no-store',
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return quota.apply(jsonError({
          error: 'Text extraction timed out — try a smaller image or a tighter crop',
          code: 'upstream_timeout',
          request_id: requestId,
        }, 504))
      }

      console.error('Image-to-text upstream request failed', { requestId, error })
      return quota.apply(jsonError({
        error: 'Text extraction service is unavailable',
        code: 'upstream_unavailable',
        request_id: requestId,
      }, 502))
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      const upstreamError = await readUpstreamError(response)
      return quota.apply(jsonError({ ...upstreamError, request_id: requestId }, response.status))
    }

    const data = await response.json()
    // Strict success criterion: a 200 with no recognized text is not a completed
    // extraction, so the reserved slot is released rather than charged.
    const gotText = Boolean(
      (typeof data?.text === 'string' ? data.text : '').trim()
      || (typeof data?.fullText === 'string' ? data.fullText : '').trim(),
    )
    return quota.apply(NextResponse.json(data, {
      status: response.status,
      headers: { 'X-Request-Id': requestId },
    }), { successful: gotText, fileName: filePart.name })

  } catch (error) {
    if (error instanceof RequestValidationError) {
      return jsonError({
        error: error.message,
        code: error.code,
        request_id: requestId,
      }, error.status)
    }

    console.error('Image-to-text route failed', { requestId, error })
    const response = jsonError({
      error: 'Failed to extract text',
      code: 'internal_error',
      request_id: requestId,
    }, 500)
    return quota?.ok ? quota.apply(response) : response
  }
}
