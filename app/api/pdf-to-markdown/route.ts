import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { microserviceFetch } from '@/lib/usage/internal'

const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 120_000
const ALLOWED_MODES = new Set(['standard', 'ocr', 'tables'])
const ALLOWED_BOOLEAN_VALUES = new Set(['true', 'false'])
const PDF_MIME_TYPES = new Set(['application/pdf', 'application/x-pdf'])

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

function readString(formData: FormData, key: string, fallback: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : fallback
}

function readRawString(formData: FormData, key: string, fallback: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value : fallback
}

function readBooleanString(formData: FormData, key: string, fallback: 'true' | 'false') {
  const value = readString(formData, key, fallback).toLowerCase()
  if (!ALLOWED_BOOLEAN_VALUES.has(value)) {
    throw new RequestValidationError(`Invalid ${key}; expected true or false`, 'invalid_boolean_option')
  }
  return value
}

function isPdfFile(file: File) {
  return PDF_MIME_TYPES.has(file.type.toLowerCase()) || file.name.toLowerCase().endsWith('.pdf')
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
          : `Conversion service returned HTTP ${response.status}`,
        code: typeof body.code === 'string' ? body.code : undefined,
      }
    } catch {
      // Fall through to the already-bounded raw response.
    }
  }

  if (contentType.includes('text/html')) {
    return {
      error: `Conversion service returned HTTP ${response.status}`,
      code: undefined,
    }
  }

  return {
    error: text || `Conversion service returned HTTP ${response.status}`,
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

    const filePart = formData.get('pdf')
    if (!(filePart instanceof File)) {
      throw new RequestValidationError('No PDF file provided', 'pdf_required')
    }

    if (!filePart.size) {
      throw new RequestValidationError('Empty PDF file', 'empty_pdf')
    }

    if (!isPdfFile(filePart)) {
      throw new RequestValidationError(
        'Unsupported file type; upload a PDF document',
        'unsupported_file_type',
        415,
      )
    }

    const maxFileBytes = parsePositiveInteger(
      process.env.PDF_TO_MARKDOWN_MAX_FILE_BYTES,
      DEFAULT_MAX_FILE_BYTES,
    )
    if (filePart.size > maxFileBytes) {
      throw new RequestValidationError(
        `PDF exceeds the ${Math.floor(maxFileBytes / (1024 * 1024))} MB upload limit`,
        'file_too_large',
        413,
      )
    }

    const mode = readString(formData, 'mode', 'standard').toLowerCase()
    if (!ALLOWED_MODES.has(mode)) {
      throw new RequestValidationError('Invalid conversion mode', 'invalid_mode')
    }

    const includeImages = readBooleanString(formData, 'include_images', 'true')
    const preserveFmt = readBooleanString(formData, 'preserve_fmt', 'true')
    const preview = readBooleanString(formData, 'preview', 'false')
    const bijoyMode = readBooleanString(formData, 'bijoy_mode', 'false')
    const lang = readString(formData, 'lang', 'auto') || 'auto'
    const pageRange = readString(formData, 'page_range', '')
    const password = readRawString(formData, 'password', '')

    quota = await beginToolQuota(request, 'pdf-to-markdown')
    if (!quota.ok) return quota.response

    const forwardFormData = new FormData()
    forwardFormData.append('pdf', filePart, filePart.name)
    forwardFormData.append('mode', mode)
    forwardFormData.append('include_images', includeImages)
    forwardFormData.append('preserve_fmt', preserveFmt)
    forwardFormData.append('lang', lang)
    forwardFormData.append('preview', preview)
    forwardFormData.append('bijoy_mode', bijoyMode)
    forwardFormData.append('page_range', pageRange)
    if (password) {
      forwardFormData.append('password', password)
    }

    const timeoutMs = parsePositiveInteger(
      process.env.PDF_TO_MARKDOWN_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
    )
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response
    try {
      response = await microserviceFetch('/convert/pdf-to-markdown', {
        method: 'POST',
        body: forwardFormData,
        headers: { 'X-Request-Id': requestId },
        cache: 'no-store',
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return quota.apply(jsonError({
          error: 'Conversion service timed out',
          code: 'upstream_timeout',
          request_id: requestId,
        }, 504))
      }

      console.error('PDF-to-Markdown upstream request failed', { requestId, error })
      return quota.apply(jsonError({
        error: 'Conversion service is unavailable',
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

    // Check if response is JSON (preview mode) or ZIP (download mode)
    const contentType = response.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      // Preview mode - return JSON as-is (includes confidence, credits_used)
      const jsonData = await response.json()
      return quota.apply(NextResponse.json(jsonData, {
        status: response.status,
        headers: { 'X-Request-Id': requestId },
      }), { successful: true, fileName: filePart.name })
    }

    // Download mode - return ZIP blob
    const blob = await response.blob()
    return quota.apply(new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': contentType || 'application/zip',
        'Content-Disposition': response.headers.get('content-disposition')
          || 'attachment; filename="mycloove_markdown.zip"',
        'X-Request-Id': requestId,
      },
    }), { successful: true, fileName: filePart.name })

  } catch (error) {
    if (error instanceof RequestValidationError) {
      return jsonError({
        error: error.message,
        code: error.code,
        request_id: requestId,
      }, error.status)
    }

    console.error('PDF-to-Markdown route failed', { requestId, error })
    const response = jsonError({
      error: 'Failed to convert PDF to Markdown',
      code: 'internal_error',
      request_id: requestId,
    }, 500)
    // Any failure after the slot was reserved must release it; the outer catch
    // otherwise bypasses the decorator and would leak the row.
    return quota?.ok ? quota.apply(response) : response
  }
}