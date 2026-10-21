import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  convertImagesToPdf,
  ImagesToPdfValidationError,
  type PageSizeOption,
  type QualityOption,
} from '@/features/image-to-pdf/server/imagesToPdf'
import { beginToolQuota } from '@/lib/usage/quota'

/**
 * Thin validating handler for the Images → PDF tool — the §5 pattern
 * (app/api/pdf-to-markdown/route.ts is the reference implementation).
 * Validate the multipart form, enforce limits, delegate the conversion to the
 * module's server engine, map failures to stable codes. No conversion logic
 * lives here.
 *
 * The limits below are mirrored in the browser (components/ImageToPDF.tsx) so
 * an oversized job is refused before upload begins; the browser copy is UX,
 * this one is the authority.
 *
 * Quota is claimed only after the request is valid, so a rejected upload does
 * not spend a conversion.
 */

const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 100 * 1024 * 1024
const DEFAULT_MAX_IMAGES = 100

const ALLOWED_PAGE_SIZES: ReadonlySet<PageSizeOption> = new Set(['original', 'a4', 'letter'])
const ALLOWED_QUALITIES: ReadonlySet<QualityOption> = new Set(['high', 'balanced', 'small'])

const IMAGE_MIME_PREFIX = 'image/'
const IMAGE_EXTENSIONS = ['.jpeg', '.jpg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff']

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
  if (file.type.toLowerCase().startsWith(IMAGE_MIME_PREFIX)) return true
  // Browsers occasionally send an empty/generic type; the extension is the
  // second signal and sharp re-validates by actually decoding the bytes.
  const name = file.name.toLowerCase()
  return IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext))
}

function jsonError(body: { error: string; code?: string; request_id: string }, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'X-Request-Id': body.request_id },
  })
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

    const images = formData
      .getAll('images')
      .filter((item): item is File => item instanceof File)

    if (!images.length) {
      throw new RequestValidationError('No images provided', 'images_required')
    }

    const maxImages = parsePositiveInteger(
      process.env.IMAGE_TO_PDF_MAX_IMAGES,
      DEFAULT_MAX_IMAGES,
    )
    if (images.length > maxImages) {
      throw new RequestValidationError(
        `Too many images — up to ${maxImages} per document`,
        'too_many_images',
        413,
      )
    }

    const maxFileBytes = parsePositiveInteger(
      process.env.IMAGE_TO_PDF_MAX_FILE_BYTES,
      DEFAULT_MAX_FILE_BYTES,
    )
    let totalBytes = 0
    for (const image of images) {
      if (!image.size) {
        throw new RequestValidationError(`Empty file: ${image.name}`, 'empty_image')
      }
      if (!isImageFile(image)) {
        throw new RequestValidationError(
          `Unsupported file type: ${image.name}`,
          'unsupported_file_type',
          415,
        )
      }
      if (image.size > maxFileBytes) {
        throw new RequestValidationError(
          `${image.name} exceeds the ${Math.floor(maxFileBytes / (1024 * 1024))} MB per-image limit`,
          'file_too_large',
          413,
        )
      }
      totalBytes += image.size
    }

    const maxTotalBytes = parsePositiveInteger(
      process.env.IMAGE_TO_PDF_MAX_TOTAL_BYTES,
      DEFAULT_MAX_TOTAL_BYTES,
    )
    if (totalBytes > maxTotalBytes) {
      throw new RequestValidationError(
        `This set exceeds the ${Math.floor(maxTotalBytes / (1024 * 1024))} MB total limit`,
        'total_size_exceeded',
        413,
      )
    }

    const pageSize = ((formData.get('pageSize') as string | null)?.trim().toLowerCase() ||
      'original') as PageSizeOption
    if (!ALLOWED_PAGE_SIZES.has(pageSize)) {
      throw new RequestValidationError('Invalid page size', 'invalid_page_size')
    }

    const quality = ((formData.get('quality') as string | null)?.trim().toLowerCase() ||
      'balanced') as QualityOption
    if (!ALLOWED_QUALITIES.has(quality)) {
      throw new RequestValidationError('Invalid quality option', 'invalid_quality')
    }

    quota = await beginToolQuota(request, 'image-to-pdf')
    if (!quota.ok) return quota.response

    const result = await convertImagesToPdf(images, { pageSize, quality })

    return quota.apply(new NextResponse(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="mycloove_converted.pdf"',
        'X-Request-Id': requestId,
        'X-Page-Count': String(result.pageCount),
        ...(result.failed.length ? { 'X-Skipped-Count': String(result.failed.length) } : {}),
      },
    }), { successful: true, fileName: images[0]?.name ?? null })
  } catch (error) {
    if (error instanceof RequestValidationError || error instanceof ImagesToPdfValidationError) {
      return jsonError(
        { error: error.message, code: error.code, request_id: requestId },
        error.status,
      )
    }

    console.error('Image-to-PDF conversion failed', { requestId, error })
    const response = jsonError(
      { error: 'Failed to convert images to PDF', code: 'conversion_failed', request_id: requestId },
      500,
    )
    return quota?.ok ? quota.apply(response) : response
  }
}
