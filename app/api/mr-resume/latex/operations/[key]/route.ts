import { handleLatexProxy } from '@/features/mr-resume/latex/server/proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params
  return handleLatexProxy(request, { action: 'operations', key }, { env: process.env })
}
