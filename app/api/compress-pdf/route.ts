import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { microserviceFetch, microserviceUrl } from '@/lib/usage/internal'
import {
  RequestValidationError,
  baseName,
  collectPdfFiles,
  formText,
  pdfOpsLimits,
  readFormData,
  readRequestId,
  withPdfOpsErrors,
} from '../_shared/pdfOpsRoute'

/**
 * POST /api/compress-pdf — thin validating proxy (CLAUDE.md §5) to the Flask
 * engine at /convert/compress-pdf (pdf-microservice/features/compress_pdf.py).
 *
 * The engine used to be pdf-lib running right here. pdf-lib cannot re-encode
 * images, so a photo-heavy PDF shrank by 0% at every level, and `aggressive`
 * deleted bookmarks/forms/links without saving a byte. PyMuPDF on the backend
 * downsamples and re-encodes images, subsets fonts and garbage-collects —
 * and verifies nothing but image fidelity changed. There is deliberately no
 * fallback to a local engine: a "compressed" file that is not smaller is the
 * exact lie this move removes, so an unreachable backend is a clear 502.
 */

const LEVELS = new Set(['light', 'strong', 'aggressive'])
const DEFAULT_TIMEOUT_MS = 120_000

/** Engine facts the UI shows; everything else upstream sends stays upstream. */
const PASS_THROUGH_HEADERS = [
  'X-Original-Bytes',
  'X-Compressed-Bytes',
  'X-Compression-Outcome',
  'X-Page-Count',
  'X-Images-Rewritten',
]

function timeoutMs() {
  const value = Number.parseInt(process.env.COMPRESS_PDF_TIMEOUT_MS ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS
}

async function upstreamError(response: Response, requestId: string) {
  let body: { error?: string; code?: string } = {}
  try {
    body = await response.json()
  } catch {
    // non-JSON upstream body: fall through to the generic message
  }
  return NextResponse.json(
    {
      error: body.error || 'The compression failed. Please try again.',
      code: body.code || 'operation_failed',
      request_id: requestId,
    },
    { status: response.status >= 500 ? 502 : response.status, headers: { 'X-Request-Id': requestId } },
  )
}

export async function POST(request: NextRequest) {
  const requestId = readRequestId(request)
  let quota: Awaited<ReturnType<typeof beginToolQuota>> | undefined
  try {
    const formData = await readFormData(request)
    const { maxFileBytes, maxTotalBytes } = pdfOpsLimits()
    const [file] = await collectPdfFiles(formData, { min: 1, max: 1, maxFileBytes, maxTotalBytes })

    const level = formText(formData, 'level', 'strong').toLowerCase()
    if (!LEVELS.has(level)) {
      throw new RequestValidationError('Compression level must be "light", "strong" or "aggressive"', 'invalid_level')
    }

    quota = await beginToolQuota(request, 'compress-pdf', formData)
    if (!quota.ok) return quota.response

    const forward = new FormData()
    forward.append('file', file, file.name)
    forward.append('level', level)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs())
    let upstream: Response
    try {
      upstream = await microserviceFetch('/convert/compress-pdf', {
        method: 'POST',
        body: forward,
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'X-Request-Id': requestId },
      })
    } catch (error) {
      const timedOut = controller.signal.aborted
      if (!timedOut) console.error('Compress PDF upstream unavailable', { requestId, url: microserviceUrl(), error })
      const failure = NextResponse.json(
        timedOut
          ? { error: 'Compression took too long. Try a smaller file or a lighter level.', code: 'upstream_timeout', request_id: requestId }
          : { error: 'The compression service is unavailable right now. Please try again shortly.', code: 'upstream_unavailable', request_id: requestId },
        { status: timedOut ? 504 : 502, headers: { 'X-Request-Id': requestId } },
      )
      return quota.apply(failure)
    } finally {
      clearTimeout(timer)
    }

    if (!upstream.ok) return quota.apply(await upstreamError(upstream, requestId))

    const headers = new Headers({
      'Content-Type': 'application/pdf',
      // Named here, not by Flask: the backend's header-safe name is ASCII-only,
      // which would turn a Bangla filename into "document".
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`mycloove_${baseName(file.name)}_compressed.pdf`)}"`,
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
    const failure = withPdfOpsErrors(error, requestId, 'Compress PDF failed')
    return quota?.ok ? quota.apply(failure) : failure
  }
}
