import { NextResponse } from 'next/server'
import { microserviceFetch } from '@/lib/usage/internal'

const UPLOAD_NAME = /^[A-Za-z0-9_-]{1,128}\.pdf$/

export async function GET(
  _request: Request,
  context: { params: Promise<{ filename: string }> },
) {
  const { filename } = await context.params
  if (!UPLOAD_NAME.test(filename || '')) {
    return new NextResponse(null, { status: 404 })
  }

  try {
    const response = await microserviceFetch(`/uploads/${filename}`, {
      method: 'GET',
      cache: 'no-store',
    })
    if (!response.ok) {
      return new NextResponse(null, { status: response.status === 404 ? 404 : 502 })
    }
    return new NextResponse(response.body, {
      status: 200,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/pdf',
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch {
    return NextResponse.json(
      { error: 'Document file service is unavailable' },
      { status: 503 },
    )
  }
}
