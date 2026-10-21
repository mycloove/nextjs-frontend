import { createClient } from '@/lib/supabase/server'
import { ensureProfileRecord, readProfile, updateProfileName, UsageStoreMissing } from '@/lib/usage/store'
import { NextResponse } from 'next/server'

/**
 * The signed-in user's own profile. Thin validating proxy (CLAUDE.md §5): read
 * the session, call one store helper, map failures. No business logic here.
 *
 * `name` is the only editable field; `email` and `role` come from Supabase Auth
 * and the account store and are read-only from this route.
 */

const MAX_NAME_CHARS = 80

export async function GET() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  const user = data.user
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  try {
    await ensureProfileRecord(user.id, user.email ?? null)
    const profile = await readProfile(user.id)
    if (profile) return NextResponse.json({ profile }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    // A profile read must not dead-end the panel. Degrade to the identity the
    // session already proves (Supabase Auth owns the email), log the reason, and
    // let the next request — once the store answers — return the full row. This
    // is the same fail-open posture the quota readers use.
    console.error('Profile read fell back to the session', error instanceof Error ? error.message : error)
  }

  return NextResponse.json(
    {
      profile: {
        id: user.id,
        email: user.email ?? null,
        name: null,
        avatar_url: null,
        role: 'User',
        active: true,
        created_at: user.created_at ?? new Date().toISOString(),
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (typeof body.name !== 'string') {
    return NextResponse.json({ error: 'name must be a string.' }, { status: 400 })
  }
  // An empty string is a valid "clear the name"; a too-long one is refused with
  // a real 400 rather than silently truncated.
  if (body.name.trim().length > MAX_NAME_CHARS) {
    return NextResponse.json({ error: `Name is too long (max ${MAX_NAME_CHARS} characters).` }, { status: 400 })
  }

  try {
    await ensureProfileRecord(data.user.id, data.user.email ?? null)
    const profile = await updateProfileName(data.user.id, body.name)
    return NextResponse.json({ profile })
  } catch (error) {
    if (error instanceof UsageStoreMissing) {
      return NextResponse.json({ error: 'The profile store is unavailable. Try again in a moment.' }, { status: 503 })
    }
    console.error('Profile update failed', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not save the name.' }, { status: 500 })
  }
}
