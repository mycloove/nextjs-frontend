import type { NextRequest } from 'next/server'
import { splitPdf } from '@/features/split-pdf/server/splitPdf'
import { beginToolQuota } from '@/lib/usage/quota'
import {
  baseName,
  collectPdfFiles,
  formText,
  pdfOpsLimits,
  pdfResponse,
  readFormData,
  readRequestId,
  withPdfOpsErrors,
  zipResponse,
} from '../_shared/pdfOpsRoute'

/**
 * POST /api/split-pdf — cut one PDF into parts by page ranges.
 * One range → a single PDF; several ranges → the parts arrive bundled as a
 * ZIP. Thin validating handler (CLAUDE.md §5); the structural split lives in
 * the module's own server engine, which also owns the range grammar errors.
 */
export async function POST(request: NextRequest) {
  const requestId = readRequestId(request)
  let quota: Awaited<ReturnType<typeof beginToolQuota>> | undefined
  try {
    const formData = await readFormData(request)
    const { maxFileBytes, maxTotalBytes } = pdfOpsLimits()
    const files = await collectPdfFiles(formData, { min: 1, max: 1, maxFileBytes, maxTotalBytes })
    const ranges = formText(formData, 'ranges')
    quota = await beginToolQuota(request, 'split-pdf')
    if (!quota.ok) return quota.response

    const { parts, pageCount } = await splitPdf(files[0], ranges)
    if (parts.length === 1) {
      return quota.apply(pdfResponse(parts[0].bytes, `mycloove_${parts[0].name}`, requestId, {
        'X-Page-Count': String(pageCount),
        'X-Part-Count': '1',
      }), { successful: true, fileName: files[0]?.name ?? null })
    }
    const response = await zipResponse(parts, `mycloove_${baseName(files[0].name)}_split.zip`, requestId)
    response.headers.set('X-Part-Count', String(parts.length))
    return quota.apply(response, { successful: true, fileName: files[0]?.name ?? null })
  } catch (error) {
    const failure = withPdfOpsErrors(error, requestId, 'Split PDF failed')
    return quota?.ok ? quota.apply(failure) : failure
  }
}