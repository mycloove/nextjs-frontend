'use client'

import { createClient } from '@/lib/supabase/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { parseCreditSnapshot } from './credit-policy'
import { listenCreditQuotes } from './credit-client'
import type { CreditBalanceState, CreditSnapshot } from './credit-types'

export const CREDITS_CHANGED_EVENT = 'mycloove:credits-changed'

type ScopedBalance = Omit<CreditBalanceState, 'refresh'> & { actorKey: string | null; epoch: number }

/**
 * One surface owns this hook and passes its state to every account readout.
 * Omit actorKey to follow Supabase; pass a verified user ID or "guest" when
 * identity is already resolved by the parent. null suspends until it is known.
 * The key only isolates client state: cookies, not this key, select the server
 * actor. No optimistic debit and no interval/network polling.
 */
export function useCreditBalance(actorKey?: string | null): CreditBalanceState {
  const [authActor, setAuthActor] = useState<string | null>(null)
  const resolvedActor = actorKey === undefined ? authActor : actorKey
  const [scope, setScope] = useState({ actorKey: resolvedActor, epoch: 0 })
  // A -> unresolved/guest -> A is a new auth epoch, never a reason to resurrect
  // the old member snapshot before the new server validation has settled.
  if (scope.actorKey !== resolvedActor) setScope({ actorKey: resolvedActor, epoch: scope.epoch + 1 })
  const [balance, setBalance] = useState<ScopedBalance>({
    actorKey: null, epoch: -1, snapshot: null, status: 'loading', refreshing: false,
  })
  const refreshRef = useRef<(() => void) | null>(null)
  const refresh = useCallback(() => refreshRef.current?.(), [])

  useEffect(() => {
    if (actorKey !== undefined) return
    const supabase = createClient()
    let alive = true
    let sequence = 0
    const track = (id: string | undefined) => {
      setAuthActor(id ?? 'guest')
      refresh()
    }
    const initialSequence = sequence
    supabase.auth.getUser()
      .then(({ data }) => {
        if (alive && sequence === initialSequence) track(data.user?.id)
      })
      .catch(() => {
        if (alive && sequence === initialSequence) track(undefined)
      })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return
      sequence += 1
      track(session?.user?.id)
    })
    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [actorKey, refresh])

  useEffect(() => {
    if (!resolvedActor) return
    let alive = true
    let sequence = 0
    let inFlight = false
    let pendingRefresh = false
    let queued = false
    let claimed = false
    let latest: CreditSnapshot | null = null
    let controller: AbortController | null = null
    let channel: BroadcastChannel | null = null
    try {
      if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CREDITS_CHANGED_EVENT)
    } catch {
      // Cross-tab hints are optional; foreground revalidation still works.
    }

    const load = async () => {
      if (!alive) return
      if (inFlight) {
        pendingRefresh = true
        return
      }
      // Serialize same-actor reads, including the first guest response that sets
      // its cookie. Opening the panel must not race two anonymous account GETs.
      inFlight = true
      const requestSequence = ++sequence
      controller = new AbortController()
      const signal = controller.signal
      const timeout = window.setTimeout(() => controller?.abort(), 15_000)
      setBalance((current) => ({
        actorKey: resolvedActor, epoch: scope.epoch,
        snapshot: current.actorKey === resolvedActor && current.epoch === scope.epoch ? current.snapshot : null,
        status: current.actorKey === resolvedActor && current.epoch === scope.epoch && current.snapshot ? 'ready' : 'loading',
        refreshing: true,
      }))
      try {
        const response = await fetch('/api/credits', { credentials: 'include', cache: 'no-store', signal })
        if (!response.ok) throw new Error('Credit balance could not be confirmed.')
        let snapshot = parseCreditSnapshot(await response.json())
        if (!alive || requestSequence !== sequence) return
        if (resolvedActor === 'guest' && snapshot.audience !== 'guest') {
          throw new Error('Account identity changed while credits were loading.')
        }
        if (resolvedActor !== 'guest' && snapshot.audience === 'guest' && snapshot.account_active) {
          throw new Error('The signed-in account could not be confirmed.')
        }
        if (!claimed && resolvedActor !== 'guest' && snapshot.audience === 'member' && snapshot.account_active &&
            (snapshot.mode === 'metered' || snapshot.mode === 'unmetered')) {
          // GET is read-only. Claim only an eligible server actor, and never
          // display its full member capacity before the guest claim settles.
          const claim = await fetch('/api/credits/claim', {
            method: 'POST', credentials: 'include', cache: 'no-store', signal,
          })
          if (!claim.ok) throw new Error('Guest credit history could not be confirmed.')
          snapshot = parseCreditSnapshot(await claim.json())
          if (!alive || requestSequence !== sequence) return
          claimed = snapshot.audience === 'member' && snapshot.account_active
        }
        if (latest) {
          const samePolicyMode = latest.mode === snapshot.mode && latest.audience === snapshot.audience &&
            latest.account_active === snapshot.account_active
          if (Date.parse(snapshot.as_of) < Date.parse(latest.as_of) ||
              (samePolicyMode && snapshot.revision < latest.revision)) {
            throw new Error('An older credit snapshot was ignored.')
          }
        }
        if (!alive || requestSequence !== sequence || pendingRefresh) return
        latest = snapshot
        setBalance({
          actorKey: resolvedActor, epoch: scope.epoch, snapshot,
          status: snapshot.mode === 'unavailable' ? 'error' : 'ready', refreshing: false,
        })
      } catch {
        if (alive && requestSequence === sequence) {
          setBalance((current) => ({
            actorKey: resolvedActor, epoch: scope.epoch,
            snapshot: current.actorKey === resolvedActor && current.epoch === scope.epoch ? current.snapshot : null,
            status: 'error', refreshing: false,
          }))
        }
      } finally {
        window.clearTimeout(timeout)
        inFlight = false
        if (alive && pendingRefresh) {
          pendingRefresh = false
          void load()
        }
      }
    }

    const invalidate = () => {
      if (!alive || queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        if (alive) void load()
      })
    }
    const onCreditChange = () => invalidate()
    const onForeground = () => {
      if (document.visibilityState === 'visible') invalidate()
    }
    if (channel) channel.onmessage = (event: MessageEvent<unknown>) => {
      // The transport emits "refresh"; never re-broadcast received hints.
      if (event.data === 'refresh' || event.data === CREDITS_CHANGED_EVENT) invalidate()
    }
    refreshRef.current = invalidate
    window.addEventListener(CREDITS_CHANGED_EVENT, onCreditChange)
    window.addEventListener('focus', onForeground)
    document.addEventListener('visibilitychange', onForeground)
    invalidate()
    return () => {
      alive = false
      controller?.abort()
      if (refreshRef.current === invalidate) refreshRef.current = null
      window.removeEventListener(CREDITS_CHANGED_EVENT, onCreditChange)
      window.removeEventListener('focus', onForeground)
      document.removeEventListener('visibilitychange', onForeground)
      channel?.close()
    }
  }, [resolvedActor, scope.epoch])

  const current = balance.actorKey === resolvedActor && balance.epoch === scope.epoch && resolvedActor ? balance : null
  const snapshot = current?.snapshot ?? null
  useEffect(() => listenCreditQuotes(snapshot), [snapshot])
  useEffect(() => {
    if (snapshot?.mode !== 'metered' || !snapshot.next_return_at || snapshot.next_return_amount <= 0) return
    // A single server-reported return, not a repeating poll. Use the server's
    // clock delta so a skewed browser clock cannot repeatedly trigger GETs.
    const delay = Date.parse(snapshot.next_return_at) - Date.parse(snapshot.as_of)
    if (delay <= 0) return
    const timer = window.setTimeout(refresh, Math.min(delay + 250, 2_147_483_647))
    return () => window.clearTimeout(timer)
  }, [snapshot, refresh])

  return {
    snapshot, status: current?.status ?? 'loading', refreshing: current?.refreshing ?? false, refresh,
  }
}
