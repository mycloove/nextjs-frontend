'use client'

import { createClient } from '@/lib/supabase/client'
import { useCallback, useEffect, useState } from 'react'

/**
 * Shared identity source for every account control in the product.
 *
 * The repo has no global auth provider on purpose (CLAUDE.md §6: no store
 * library; each surface resolves its own session). This hook is the single
 * resolver those surfaces share, so the home topbar, the tool topbars and the
 * Mr. Markdown workspace all read the *same* identity shape — email, display
 * name, role and avatar — without one reaching into another's state.
 *
 * The Supabase session proves the identity; `/api/profile` adds the
 * product-side fields (display name, avatar, role) that Supabase Auth does not
 * own. If the profile read fails, it degrades to the session email rather than
 * blanking the control — the same fail-open posture `/api/profile` itself uses.
 */
export type AccountViewer = {
  email: string | null
  name: string | null
  role: string | null
  avatarUrl: string | null
}

export type AccountViewerState = {
  /** `loading` until the first session + profile resolution settles. */
  status: 'loading' | 'ready'
  /** `null` when signed out; the control renders its guest form then. */
  viewer: AccountViewer | null
  /** Re-read identity (used after a profile or avatar change). */
  refresh: () => void
  signOut: () => Promise<void>
}

type ProfilePayload = {
  email?: string | null
  name?: string | null
  role?: string | null
  avatar_url?: string | null
}

export function useAccountViewer(): AccountViewerState {
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [viewer, setViewer] = useState<AccountViewer | null>(null)
  // Bumping the nonce re-runs the resolver effect; this is the refresh handle
  // callers get, so a name or avatar save can re-read without remounting.
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    const supabase = createClient()
    let alive = true

    const resolve = async (userId: string | undefined, userEmail: string | undefined) => {
      if (!userId) {
        if (alive) {
          setViewer(null)
          setStatus('ready')
        }
        return
      }
      let profile: ProfilePayload | null = null
      try {
        const response = await fetch('/api/profile', { credentials: 'include', cache: 'no-store' })
        if (response.ok) {
          const body = (await response.json()) as { profile?: ProfilePayload } | null
          profile = body?.profile ?? null
        }
      } catch {
        // Fall through to the session identity; a profile read must never
        // dead-end the control.
      }
      if (!alive) return
      setViewer({
        email: profile?.email ?? userEmail ?? null,
        name: profile?.name ?? null,
        role: profile?.role ?? null,
        avatarUrl: profile?.avatar_url ?? null,
      })
      setStatus('ready')
    }

    supabase.auth.getUser().then(({ data }) => {
      void resolve(data.user?.id, data.user?.email)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void resolve(session?.user?.id, session?.user?.email)
    })

    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [nonce])

  const signOut = useCallback(async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
  }, [])

  return { status, viewer, refresh, signOut }
}
