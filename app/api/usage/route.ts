import { NextResponse } from 'next/server'
import { applyAnonCookie } from '@/lib/usage/cookie'
import { claimGuestUsage, readUsageSnapshot } from '@/lib/usage/quota'

export async function GET(request: Request) {
  try {
    const toolId = new URL(request.url).searchParams.get('tool')
    const { snapshot, anonId, persistCookie } = await readUsageSnapshot(toolId)
    return applyAnonCookie(NextResponse.json(snapshot), anonId, persistCookie)
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Usage snapshot failed',
        code: 'usage_unavailable',
      },
      { status: 503 },
    )
  }
}

export async function POST() {
  try {
    const { snapshot, claimed, anonId, persistCookie } = await claimGuestUsage()
    return applyAnonCookie(
      NextResponse.json({ ...snapshot, claimed }),
      anonId,
      persistCookie,
    )
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Could not map guest usage',
        code: 'usage_claim_failed',
      },
      { status: 503 },
    )
  }
}
