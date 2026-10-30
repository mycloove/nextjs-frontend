import { handleLatexProxy } from '@/features/mr-resume/latex/server/proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return handleLatexProxy(request, { action: 'capabilities' }, { env: process.env })
}
