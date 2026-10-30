import { handleLatexProxy } from '@/features/mr-resume/latex/server/proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return handleLatexProxy(request, { action: 'cancel' }, { env: process.env })
}
