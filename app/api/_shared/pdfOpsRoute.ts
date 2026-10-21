import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isPdfFile } from '@/lib/pdf/pdfUtils'

/**
 * Shared HTTP plumbing for the four structural-PDF tool routes (merge, split,
 * rotate, compress) — the §5 thin-validating-proxy pattern factored once
 * instead of copy-pasted across four route files (same idea as
 * `app/api/diagrams/_shared.ts`).
 *
 * Business rules stay in each feature's own server engine; this kit only owns
 * transport concerns: request ids, multipart parsing, upload limits and the
 * binary/ZIP response shapes. The limits use the same env names the old
 * combined /api/pdf-tools endpoint used, so deployment config keeps working,
 * and they are mirrored in every tool's browser UI so an oversized job is
 * refused before upload begins.
 */

export class RequestValidationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'RequestValidationError'
  }
}

const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 150 * 1024 * 1024
const DEFAULT_MAX_FILES = 20

export function parsePositiveInteger(rawValue: string | undefined, fallback: number) {
  if (!rawValue) return fallback
  const value = Number.parseInt(rawValue, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** The shared per-file/per-job ceilings, read from env with literal defaults. */
export function pdfOpsLimits() {
  return {
    maxFiles: parsePositiveInteger(process.env.PDF_TOOLS_MAX_FILES, DEFAULT_MAX_FILES),
    maxFileBytes: parsePositiveInteger(process.env.PDF_TOOLS_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES),
    maxTotalBytes: parsePositiveInteger(process.env.PDF_TOOLS_MAX_TOTAL_BYTES, DEFAULT_MAX_TOTAL_BYTES),
  }
}

export function readRequestId(request: NextRequest) {
  return request.headers.get('x-request-id')?.trim() || randomUUID()
}

export async function readFormData(request: NextRequest) {
  try {
    return await request.formData()
  } catch {
    throw new RequestValidationError('Invalid multipart form data', 'invalid_multipart_form')
  }
}

/** A string form field, trimmed, with a fallback when absent. */
export function formText(formData: FormData, key: string, fallback = '') {
  const raw = formData.get(key)
  return typeof raw === 'string' ? raw.trim() : fallback
}

/** Collect `files` entries, enforcing the family-wide PDF/size ceilings. */
export function collectPdfFiles(
  formData: FormData,
  limits: { min: number; max: number; maxFileBytes: number; maxTotalBytes: number },
) {
  const files = formData
    .getAll('files')
    .filter((item): item is File => item instanceof File)

  if (files.length < limits.min) {
    throw new RequestValidationError(
      limits.min > 1 ? `This operation needs at least ${limits.min} PDFs` : 'No PDF file was uploaded',
      'too_few_files',
    )
  }
  if (files.length > limits.max) {
    throw new RequestValidationError(`Too many files — up to ${limits.max} per job`, 'too_many_files', 413)
  }

  let totalBytes = 0
  for (const file of files) {
    if (!file.size) throw new RequestValidationError(`Empty file: ${file.name}`, 'empty_file')
    if (!isPdfFile(file)) {
      throw new RequestValidationError(`Not a PDF: ${file.name}`, 'unsupported_file_type', 415)
    }
    if (file.size > limits.maxFileBytes) {
      throw new RequestValidationError(
        `${file.name} exceeds the ${Math.floor(limits.maxFileBytes / (1024 * 1024))} MB per-file limit`,
        'file_too_large',
        413,
      )
    }
    totalBytes += file.size
  }
  if (totalBytes > limits.maxTotalBytes) {
    throw new RequestValidationError(
      `This set exceeds the ${Math.floor(limits.maxTotalBytes / (1024 * 1024))} MB total limit`,
      'total_size_exceeded',
      413,
    )
  }
  return files
}

function jsonError(body: { error: string; code?: string; request_id: string }, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'X-Request-Id': body.request_id },
  })
}

export function baseName(name: string) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export function pdfResponse(
  bytes: Uint8Array,
  filename: string,
  requestId: string,
  extraHeaders: Record<string, string> = {},
) {
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'X-Request-Id': requestId,
      ...extraHeaders,
    },
  })
}

export async function zipResponse(
  parts: Array<{ name: string; bytes: Uint8Array }>,
  zipName: string,
  requestId: string,
) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  for (const part of parts) zip.file(part.name, part.bytes)
  const blob = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return new NextResponse(new Uint8Array(blob), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(zipName)}"`,
      'X-Request-Id': requestId,
    },
  })
}

/** Every engine error in this family carries a stable code + status; anything
    else is an unexpected failure and must not leak its internals. */
function isFixableError(error: unknown): error is Error & { code: string; status: number } {
  return (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { status?: unknown }).status === 'number'
  )
}

export function withPdfOpsErrors(error: unknown, requestId: string, logLabel: string) {
  if (isFixableError(error)) {
    return jsonError({ error: error.message, code: error.code, request_id: requestId }, error.status)
  }
  console.error(logLabel, { requestId, error })
  return jsonError(
    { error: 'The PDF operation failed', code: 'operation_failed', request_id: requestId },
    500,
  )
}
