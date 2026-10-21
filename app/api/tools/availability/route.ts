import { NextResponse } from 'next/server'
import { listToolAvailability } from '@/lib/usage/controls'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const tools = await listToolAvailability()
    return NextResponse.json(
      { tools },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    /*
      An unreadable store is not the same answer as "every tool is withdrawn".

      Answering 200 with an empty list made the client believe it had a valid,
      authoritative answer: the home page dropped every tool card and every nav
      entry except its two in-page anchors, and the cards only came back once
      the store was reachable again. A non-OK status says "availability is
      unknown", which is what the callers already handle — useToolAvailability,
      ToolRouteGate, ServiceGate and HomeFooter all fail open on it, matching
      isToolOpen()'s rule that a missing table or an unset DATABASE_URL leaves
      every tool open.
    */
    const message =
      error instanceof Error ? error.message : 'Tool availability is unavailable.'
    console.error(`[tools/availability] ${message}`)
    return NextResponse.json(
      { tools: null, error: message },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
