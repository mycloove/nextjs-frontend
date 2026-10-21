import { NextResponse } from 'next/server'

function retired() {
  return NextResponse.json(
    { error: 'Call limits are stored per tool. Use the bench at /admin.' },
    { status: 410 },
  )
}

export const GET = retired
export const PUT = retired
export const POST = retired
// NOTE(B3-4/D3-1, 2026-10-06): this stub is intentionally kept as an
// unauthenticated 410 with zero auth surface — it leaks nothing and tells
// scanners/operators where limits moved. Per-tool caps live in
// lib/usage/{store,controls}.ts via /api/admin/tools. The retired plans UI
// (app/admin/plans/*) was deleted; the UsagePlan/UsageAudience helpers in
// lib/usage/{types,parse}.ts stay because snapshot.plan is still live
// product copy (components/PDFToMarkdown reads plan.name/period).

