import type { NextRequest } from 'next/server'
import { parseRotatePdfPagePlan, rotatePdf, rotatePdfPagePlan } from '@/features/rotate-pdf/server/rotatePdf'
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
 * POST /api/rotate-pdf — turn pages by a quarter-turn (90, 180 or 270
 * degrees). `ranges` is optional: empty rotates the whole document. Thin
 * validating handler (CLAUDE.md §5); angle and range validation live in the
 * module's own server engine, which maps them to stable status/code pairs.
 */
export async function POST(request: NextRequest) {
  const requestId = readRequestId(request)
  let quota: Awaited<ReturnType<typeof beginToolQuota>> | undefined
  try {
    const formData = await readFormData(request)
    const { maxFileBytes, maxTotalBytes } = pdfOpsLimits()
    const files = await collectPdfFiles(formData, { min: 1, max: 1, maxFileBytes, maxTotalBytes })

    const pagePlanRaw = formText(formData, 'pagePlan')
    const angle = Number.parseInt(formText(formData, 'angle', '90'), 10)
    const ranges = formText(formData, 'ranges')
    quota = await beginToolQuota(request, 'rotate-pdf')
    if (!quota.ok) return quota.response

    // pagePlan is additive: existing API callers can continue to use angle/ranges.
    const result = pagePlanRaw
      ? await rotatePdfPagePlan(files[0], parseRotatePdfPagePlan(pagePlanRaw))
      : await rotatePdf(files[0], angle, ranges)
    const { bytes, rotated } = result
    return quota.apply(pdfResponse(bytes, `mycloove_${baseName(files[0].name)}_rotated.pdf`, requestId, {
      'X-Rotated-Pages': String(rotated),
    }), { successful: true, fileName: files[0]?.name ?? null })
  } catch (error) {
    const failure = withPdfOpsErrors(error, requestId, 'Rotate PDF failed')
    return quota?.ok ? quota.apply(failure) : failure
  }
}
