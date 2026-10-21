import type { ActivityRow, Profile } from '@/lib/usage/types'

export type { ActivityRow, Profile }

/**
 * Client-side wrappers for the owner's own profile routes. No caching library
 * (CLAUDE.md §6): plain fetch, and every call is a fresh read because the data
 * is the signed-in user's own and changes with their actions.
 */

export async function fetchProfile(): Promise<Profile | null> {
  const response = await fetch('/api/profile', { credentials: 'include', cache: 'no-store' })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('Could not load your profile.')
  const body = (await response.json()) as { profile?: Profile }
  return body.profile ?? null
}

export async function saveProfileName(name: string): Promise<Profile> {
  const response = await fetch('/api/profile', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const body = (await response.json().catch(() => null)) as { profile?: Profile; error?: string } | null
  if (!response.ok || !body?.profile) {
    throw new Error(body?.error || 'Could not save your name.')
  }
  return body.profile
}

export async function uploadAvatar(file: File): Promise<Profile> {
  const form = new FormData()
  form.append('avatar', file)
  const response = await fetch('/api/profile/avatar', {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
  const body = (await response.json().catch(() => null)) as { profile?: Profile; error?: string } | null
  if (!response.ok || !body?.profile) {
    throw new Error(body?.error || 'Could not upload your photo.')
  }
  return body.profile
}

export async function removeAvatar(): Promise<Profile> {
  const response = await fetch('/api/profile/avatar', {
    method: 'DELETE',
    credentials: 'include',
  })
  const body = (await response.json().catch(() => null)) as { profile?: Profile; error?: string } | null
  if (!response.ok || !body?.profile) {
    throw new Error(body?.error || 'Could not remove your photo.')
  }
  return body.profile
}

export async function fetchActivity(take: number, skip: number): Promise<{ rows: ActivityRow[]; total: number }> {
  const response = await fetch(`/api/profile/activity?take=${take}&skip=${skip}`, {
    credentials: 'include',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('Could not load your activity.')
  const body = (await response.json()) as { rows?: ActivityRow[]; total?: number }
  return { rows: body.rows ?? [], total: body.total ?? 0 }
}
