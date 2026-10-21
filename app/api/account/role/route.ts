import { createClient } from '@/lib/supabase/server'
import { ensureProfileRecord, readAccountStatus, UsageStoreMissing } from '@/lib/usage/store'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) return NextResponse.json({ role: null }, { status: 401 })

  try {
    await ensureProfileRecord(data.user.id, data.user.email ?? null)
    const status = await readAccountStatus(data.user.id)
    return NextResponse.json({ role: status.role, active: status.active })
  } catch (error) {
    if (error instanceof UsageStoreMissing) {
      return NextResponse.json({ role: 'User' })
    }
    return NextResponse.json({ role: 'User' })
  }
}
