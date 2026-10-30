import { handleLatexProxy } from '@/features/mr-resume/latex/server/proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return handleLatexProxy(request, { action: 'artifacts', id }, { env: process.env })
}
