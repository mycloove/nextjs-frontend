import { adminRefusal, requireAdmin } from '@/lib/usage/admin'
import {
  listAdminToolControlsGrouped,
  readAdminAuditEvents,
  readAdminGuests,
  readAdminUsageSummaries,
  readAdminUsers,
} from '@/lib/usage/controls'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'

const EXPORT_LIMIT = 5000
const PAGE_SIZE = 250

function csvCell(value: unknown) {
  let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  // Spreadsheet applications may execute cells beginning with formula syntax.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return 'No rows\r\n'
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  return [columns.map(csvCell).join(','), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))].join('\r\n') + '\r\n'
}

function download(body: string, dataset: string, requestId: string, truncated = false) {
  const response = new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="admin-${dataset}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
      ...(truncated ? { 'X-Export-Truncated': 'true' } : {}),
    },
  })
  return response
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  const gate = await requireAdmin()
  if (!gate.ok) {
    const refusal = adminRefusal(gate)
    const response = NextResponse.json({ error: refusal.error, request_id: requestId }, { status: refusal.status })
    response.headers.set('X-Request-Id', requestId)
    return response
  }

  const params = new URL(request.url).searchParams
  const dataset = params.get('dataset')
  let rows: Record<string, unknown>[] = []
  let truncated = false

  if (dataset === 'tools') {
    const [tools, usageRead] = await Promise.all([listAdminToolControlsGrouped(), readAdminUsageSummaries()])
    rows = tools.map((tool) => ({
      tool_id: tool.tool_id,
      label: tool.label,
      group: tool.group,
      enabled: tool.enabled,
      guest_limit: tool.guest_limit,
      member_limit: tool.member_limit,
      period: tool.period,
      guest_used: tool.period === 'week' ? usageRead.data[tool.tool_id]?.guest_used_7d : usageRead.data[tool.tool_id]?.guest_used_24h,
      member_used: tool.period === 'week' ? usageRead.data[tool.tool_id]?.member_used_7d : usageRead.data[tool.tool_id]?.member_used_24h,
      usage_degraded: usageRead.degraded,
    }))
  } else if (dataset === 'users' || dataset === 'browsers') {
    const query = dataset === 'users' ? (params.get('q') || '').slice(0, 200) : ''
    if (dataset === 'browsers') {
      const page = await readAdminGuests({ take: EXPORT_LIMIT, skip: 0 })
      if (page.degraded) throw new Error(page.message || 'The requested data could not be read.')
      rows.push(...page.data.rows as unknown as Record<string, unknown>[])
      truncated = page.data.total > EXPORT_LIMIT
    } else {
      for (let skip = 0; skip < EXPORT_LIMIT; skip += PAGE_SIZE) {
        const page = await readAdminUsers({ query, take: PAGE_SIZE, skip })
        if (page.degraded) throw new Error(page.message || 'The requested data could not be read.')
        rows.push(...page.data.rows as unknown as Record<string, unknown>[])
        if (page.data.rows.length < PAGE_SIZE) break
        if (skip + PAGE_SIZE >= EXPORT_LIMIT) truncated = page.data.total > EXPORT_LIMIT
      }
    }
  } else if (dataset === 'audit') {
    const action = params.get('action') || undefined
    for (let skip = 0; skip < EXPORT_LIMIT; skip += PAGE_SIZE) {
      const page = await readAdminAuditEvents({ take: PAGE_SIZE, skip, action })
      if (page.degraded) throw new Error(page.message || 'The audit history could not be read.')
      rows.push(...page.data.rows as unknown as Record<string, unknown>[])
      if (page.data.rows.length < PAGE_SIZE) break
      if (skip + PAGE_SIZE >= EXPORT_LIMIT) truncated = page.data.total > EXPORT_LIMIT
    }
  } else {
    const response = NextResponse.json({ error: 'dataset must be tools, users, browsers, or audit', request_id: requestId }, { status: 400 })
    response.headers.set('X-Request-Id', requestId)
    return response
  }

  return download(toCsv(rows), dataset, requestId, truncated)
}
