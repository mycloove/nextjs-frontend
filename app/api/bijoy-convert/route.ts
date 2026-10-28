import { NextRequest, NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { withMicroserviceHeaders } from '@/lib/usage/internal'

/**
 * Thin validating proxy for the Bijoy plain-text converter (§5 pattern).
 * JSON in, JSON out — all conversion logic lives in
 * pdf-microservice/features/bijoy_text.py, which reuses Mr. Markdown's
 * proven convert_bijoy_text engine.
 */

const BACKEND_URL = process.env.PDF_MICROSERVICE_URL ?? 'http://localhost:5000'
const TIMEOUT_MS = 30_000
const MAX_TEXT_CHARS = 400_000

type ErrorBody = { error: string; code?: string }

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' } satisfies ErrorBody, { status: 400 })
  }

  const text = (body as { text?: unknown })?.text
  if (typeof text !== 'string') {
    return NextResponse.json({ error: 'A string "text" field is required.' } satisfies ErrorBody, { status: 400 })
  }
  if (text.length > MAX_TEXT_CHARS) {
    return NextResponse.json(
      { error: `Text exceeds the ${MAX_TEXT_CHARS}-character limit.` } satisfies ErrorBody,
      { status: 413 },
    )
  }

  const quota = await beginToolQuota(request, 'bijoy-converter', body)
  if (!quota.ok) return quota.response

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const upstream = await fetch(`${BACKEND_URL}/api/bijoy/convert`, {
      method: 'POST',
      headers: withMicroserviceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })
    const contentType = upstream.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      return quota.apply(NextResponse.json(
        { error: `Bijoy service returned HTTP ${upstream.status}.` } satisfies ErrorBody,
        { status: 502 },
      ))
    }
    return quota.apply(NextResponse.json(await upstream.json(), { status: upstream.status }))
  } catch {
    return quota.apply(NextResponse.json(
      { error: 'The Bijoy service is unreachable. Please try again shortly.' } satisfies ErrorBody,
      { status: 503 },
    ))
  } finally {
    clearTimeout(timeout)
  }
}
