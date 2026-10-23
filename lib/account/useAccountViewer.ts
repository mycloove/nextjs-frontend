'use client'

import { createClient } from '@/lib/supabase/client'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Shared identity source for every account control in the product.
 *
 * The repo has no global auth provider on purpose (CLAUDE.md §6: no store
 * library; each surface resolves its own session). This hook is the single
 * resolver those surfaces share, so the home topbar, the tool topbars and the
 * Mr. Markdown workspace all read the *same* identity shape — email, display
 * name, role, eligibility and avatar — without one reaching into another's state.
 *
 * The Supabase session proves the identity; `/api/profile` adds the
 * product-side fields (display name, avatar, role) that Supabase Auth does not
 * own. If the profile read fails, it degrades to the session email rather than
 * blanking the control — the same fail-open posture `/api/profile` itself uses.
 */
export type AccountViewer = {
  /** Supabase's authenticated ID, never an email-derived account key. */
  id: string
  email: string | null
  name: string | null
  role: string | null
  avatarUrl: string | null
  /** Unknown when the profile cannot be read; credit eligibility stays server-owned. */
  active: boolean | null
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
  id?: string
  email?: string | null
  name?: string | null
  role?: string | null
  avatar_url?: string | null
  active?: boolean
}

export function useAccountViewer(): AccountViewerState {
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [viewer, setViewer] = useState<AccountViewer | null>(null)
  const actorRef = useRef<string | null>(null)
  // Bumping the nonce re-runs the resolver effect; this is the refresh handle
  // callers get, so a name or avatar save can re-read without remounting.
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    const supabase = createClient()
    let alive = true
    let sequence = 0
    let controller: AbortController | null = null

    const resolve = async (userId: string | undefined, userEmail: string | undefined) => {
      const requestSequence = ++sequence
      controller?.abort()
      const actorChanged = actorRef.current !== (userId ?? null)
      actorRef.current = userId ?? null
      if (!userId) {
        if (alive) {
          setViewer(null)
          setStatus('ready')
          window.dispatchEvent(new CustomEvent('mycloove:credits-changed'))
        }
        return
      }
      if (actorChanged && alive) {
        // Do not keep another account's photo/name visible while its replacement
        // resolves. Consumers also suspend their credit snapshot in this state.
        setViewer(null)
        setStatus('loading')
      }
      controller = new AbortController()
      const signal = controller.signal
      let profile: ProfilePayload | null = null
      try {
        const response = await fetch('/api/profile', { credentials: 'include', cache: 'no-store', signal })
        if (response.ok) {
          const body = (await response.json()) as { profile?: ProfilePayload } | null
          // Auth owns the identity; a delayed profile for another actor is not
          // an acceptable fallback, even when its email looks plausible.
          if (body?.profile?.id === userId) profile = body.profile
        }
      } catch {
        // Fall through to the session identity; a profile read must never
        // dead-end the control.
      }
      if (!alive || requestSequence !== sequence) return
      setViewer({
        id: userId,
        email: userEmail ?? (typeof profile?.email === 'string' ? profile.email : null),
        name: typeof profile?.name === 'string' ? profile.name : null,
        role: typeof profile?.role === 'string' ? profile.role : null,
        avatarUrl: typeof profile?.avatar_url === 'string' ? profile.avatar_url : null,
        active: typeof profile?.active === 'boolean' ? profile.active : null,
      })
      setStatus('ready')
      window.dispatchEvent(new CustomEvent('mycloove:credits-changed'))
    }

    const initialSequence = sequence
    supabase.auth.getUser()
      .then(({ data }) => {
        if (alive && sequence === initialSequence) void resolve(data.user?.id, data.user?.email)
      })
      .catch(() => {
        if (alive && sequence === initialSequence) void resolve(undefined, undefined)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) void resolve(session?.user?.id, session?.user?.email)
    })

    return () => {
      alive = false
      controller?.abort()
      subscription.unsubscribe()
    }
  }, [nonce])

  const signOut = useCallback(async () => {
    const supabase = createClient()
    const { error } = await supabase.auth.signOut()
    if (error) throw new Error(error.message)
  }, [])

  return { status, viewer, refresh, signOut }
}
