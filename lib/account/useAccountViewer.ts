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
 * Identity resolution order (AUTH-INDEPENDENCE plan):
 *  1. `/api/auth/me` — the custom account session first; the endpoint itself
 *     bridges to the Supabase session for legacy/Google identities and answers
 *     with the same profile fields either way.
 *  2. A direct Supabase read as fallback — only used when the endpoint says
 *     signed-out, so a legacy browser never renders a guest form for a live
 *     Supabase session while transport hiccups sort themselves out.
 * If the profile read fails, it degrades to the session email rather than
 * blanking the control — the same fail-open posture `/api/profile` uses.
 */
export type AccountViewer = {
  /** The product user id (users.id) — the key every usage/credit row uses. */
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

type MePayload = {
  signed_in?: boolean
  user?: {
    id?: string
    email?: string | null
    name?: string | null
    role?: string | null
    active?: boolean
    avatar_url?: string | null
  } | null
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

    const commitViewer = (next: AccountViewer | null) => {
      const actorChanged = actorRef.current !== (next?.id ?? null)
      actorRef.current = next?.id ?? null
      if (actorChanged) {
        // Do not keep another account's photo/name visible while its
        // replacement resolves. Consumers also suspend their credit snapshot
        // in this state.
        setViewer(null)
        setStatus(next ? 'loading' : 'ready')
      }
      if (next) setViewer(next)
      window.dispatchEvent(new CustomEvent('mycloove:credits-changed'))
    }

    const resolveFromProfile = async (userId: string | undefined, userEmail: string | undefined, requestSequence: number) => {
      controller?.abort()
      if (!userId) {
        if (alive) {
          setViewer(null)
          setStatus('ready')
          window.dispatchEvent(new CustomEvent('mycloove:credits-changed'))
        }
        return
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
      commitViewer({
        id: userId,
        email: userEmail ?? (typeof profile?.email === 'string' ? profile.email : null),
        name: typeof profile?.name === 'string' ? profile.name : null,
        role: typeof profile?.role === 'string' ? profile.role : null,
        avatarUrl: typeof profile?.avatar_url === 'string' ? profile.avatar_url : null,
        active: typeof profile?.active === 'boolean' ? profile.active : null,
      })
      if (alive) setStatus('ready')
    }

    const resolve = async (requestSequence: number) => {
      // 1. The unified endpoint (custom session → Supabase bridge inside).
      let me: MePayload | null = null
      try {
        const response = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
        if (response.ok) me = (await response.json()) as MePayload
      } catch {
        // Transport failure: fall through to the direct Supabase read below.
      }
      if (!alive || requestSequence !== sequence) return
      if (me?.signed_in && me.user?.id) {
        commitViewer(meToViewer(me))
        setStatus('ready')
        return
      }
      // 2. Direct Supabase fallback for a session the endpoint could not see.
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }))
      if (!alive || requestSequence !== sequence) return
      await resolveFromProfile(data.user?.id, data.user?.email, requestSequence)
    }

    const initialSequence = sequence
    void resolve(initialSequence)

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return
      // Supabase events matter for legacy/Google sessions; the /api/auth/me
      // read decides the truth either way, so an event is just a nudge to
      // re-resolve (a custom-session logout also fires its own refresh).
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || session?.user) {
        void resolve(++sequence)
      }
    })

    return () => {
      alive = false
      controller?.abort()
      subscription.unsubscribe()
    }
  }, [nonce])

  const signOut = useCallback(async () => {
    // Clear both identity systems: the custom DB session and any Supabase
    // session the browser may hold (whichever exists is a no-op for the other).
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {
      // The cookie still expires server-side; never dead-end a logout click.
    })
    const supabase = createClient()
    const { error } = await supabase.auth.signOut()
    if (error) throw new Error(error.message)
  }, [])

  return { status, viewer, refresh, signOut }
}

function meToViewer(me: MePayload): AccountViewer {
  const user = me.user ?? {}
  return {
    id: String(user.id ?? ''),
    email: typeof user.email === 'string' ? user.email : null,
    name: typeof user.name === 'string' ? user.name : null,
    role: typeof user.role === 'string' ? user.role : null,
    avatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url : null,
    active: typeof user.active === 'boolean' ? user.active : null,
  }
}
