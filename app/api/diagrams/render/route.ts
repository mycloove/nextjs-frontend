import { NextRequest, NextResponse } from 'next/server'
import {
  renderServerDiagram,
  SERVER_ENGINES,
  SOURCE_LIMIT,
  type ServerDiagramRequest,
} from '../_shared'
import type { DiagramAttributes, DiagramEngine } from '@/components/PDFToMarkdown/diagrams/types'

export const runtime = 'nodejs'

function safeAttributes(value: unknown): DiagramAttributes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'string' || typeof item === 'boolean'))
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > SOURCE_LIMIT * 2) return NextResponse.json({ error: 'Diagram request is too large.' }, { status: 413 })
  const body = await request.json().catch(() => null) as Partial<ServerDiagramRequest> | null
  if (!body || !SERVER_ENGINES.has(body.engine as DiagramEngine) || typeof body.source !== 'string') {
    return NextResponse.json({ error: 'Invalid diagram request.' }, { status: 400 })
  }
  if (Buffer.byteLength(body.source, 'utf8') > SOURCE_LIMIT) {
    return NextResponse.json({ error: 'Diagram source is too large.' }, { status: 413 })
  }

  const diagramRequest: ServerDiagramRequest = {
    engine: body.engine as DiagramEngine,
    language: typeof body.language === 'string' ? body.language.slice(0, 80) : '',
    source: body.source,
    attributes: safeAttributes(body.attributes),
  }
  try {
    return NextResponse.json(await renderServerDiagram(diagramRequest), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Diagram rendering failed.'
    const unavailable = /not configured|not enabled|not ready|temporarily unavailable|requires an isolated|HTTP 5\d\d/i.test(message)
    return NextResponse.json({ error: message }, { status: unavailable ? 503 : 422 })
  }
}