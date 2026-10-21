import { NextResponse } from 'next/server'
import { resolvedServerCapabilities } from '../_shared'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(
    { engines: await resolvedServerCapabilities() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}