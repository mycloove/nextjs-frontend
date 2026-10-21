import type { NextRequest } from 'next/server'
import { compressPdf, type CompressLevel } from '@/features/compress-pdf/server/compressPdf'
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
} from '../_shared/pdfOpsRoute'

/**
 * POST /api/compress-pdf — structural shrink of one PDF. `level` is `light`
 * (safe, keeps metadata), `strong` (also drops metadata) or `aggressive`
 * (also drops optional catalog trees and annotations). Thin validating
 * handler (CLAUDE.md §5); the structural compression lives in the module's
 * own server engine.
 */
export async function POST(request: NextRequest) {
  const requestId = readRequestId(request)
  let quota: Awaited<ReturnType<typeof beginToolQuota>> | undefined
  try {
    const formData = await readFormData(request)
    const { maxFileBytes, maxTotalBytes } = pdfOpsLimits()
    const files = await collectPdfFiles(formData, { min: 1, max: 1, maxFileBytes, maxTotalBytes })

    const level = formText(formData, 'level', 'light').toLowerCase() as CompressLevel
    quota = await beginToolQuota(request, 'compress-pdf')
    if (!quota.ok) return quota.response
    const { bytes, originalBytes } = await compressPdf(files[0], level)
    return quota.apply(pdfResponse(bytes, `mycloove_${baseName(files[0].name)}_compressed.pdf`, requestId, {
      'X-Original-Bytes': String(originalBytes),
      'X-Compressed-Bytes': String(bytes.length),
    }), { successful: true, fileName: files[0]?.name ?? null })
  } catch (error) {
    const failure = withPdfOpsErrors(error, requestId, 'Compress PDF failed')
    return quota?.ok ? quota.apply(failure) : failure
  }
}