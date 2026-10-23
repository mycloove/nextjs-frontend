import type { NextRequest } from 'next/server'
import { mergePdfs } from '@/features/merge-pdf/server/mergePdf'
import { beginToolQuota } from '@/lib/usage/quota'
import {
  baseName,
  collectPdfFiles,
  pdfOpsLimits,
  pdfResponse,
  readFormData,
  readRequestId,
  withPdfOpsErrors,
} from '../_shared/pdfOpsRoute'

/**
 * POST /api/merge-pdf — combine two or more PDFs into one document, in order.
 *
 * Thin validating handler (CLAUDE.md §5): limits and file checks live here;
 * the structural merge lives in the module's own server engine. The old
 * combined /api/pdf-tools endpoint is retired — each structural operation
 * now owns its URL.
 */
export async function POST(request: NextRequest) {
  const requestId = readRequestId(request)
  let quota: Awaited<ReturnType<typeof beginToolQuota>> | undefined
  try {
    const formData = await readFormData(request)
    const { maxFiles, maxFileBytes, maxTotalBytes } = pdfOpsLimits()
    const files = await collectPdfFiles(formData, { min: 2, max: maxFiles, maxFileBytes, maxTotalBytes })
    quota = await beginToolQuota(request, 'merge-pdf', formData)
    if (!quota.ok) return quota.response

    const { bytes, sourceCount } = await mergePdfs(files)
    return quota.apply(pdfResponse(bytes, `mycloove_${baseName(files[0].name)}_merged.pdf`, requestId, {
      'X-Source-Count': String(sourceCount),
    }), { successful: true, fileName: files[0]?.name ?? null })
  } catch (error) {
    const failure = withPdfOpsErrors(error, requestId, 'Merge PDF failed')
    // An engine failure after the slot was reserved must release it.
    return quota?.ok ? quota.apply(failure) : failure
  }
}
