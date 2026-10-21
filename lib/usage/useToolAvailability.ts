'use client'

import { useCallback, useEffect, useState } from 'react'

type Availability = {
  tool_id: string
  enabled: boolean
}

type AvailabilityPayload = {
  tools?: Availability[]
  /** Set when the server could not read the tool store. */
  degraded?: boolean
}

/**
 * A tool is shown only when the catalog row says enabled: true.
 * While the request is still in flight, callers that check `status` can wait.
 * A failed read leaves the previous library in place so a blip does not blank the page.
 */
export function useToolAvailability() {
  const [byId, setById] = useState<Record<string, boolean> | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    fetch('/api/tools/availability', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('availability unavailable')
        return response.json() as Promise<AvailabilityPayload>
      })
      .then((payload) => {
        if (cancelled) return
        // `degraded` means the server lost its store, not that an admin closed
        // the bench. Treating an empty list as "everything is off" is the one
        // way this hook could hide the whole product, so it fails open here and
        // `enabled()` keeps answering true, matching isToolOpen and beginToolQuota.
        if (payload.degraded) {
          setStatus('error')
          return
        }
        const next: Record<string, boolean> = {}
        for (const tool of payload.tools ?? []) {
          if (tool && typeof tool.tool_id === 'string') next[tool.tool_id] = tool.enabled === true
        }
        setById(next)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const enabled = useCallback(
    (toolId: string) => status !== 'ready' || byId?.[toolId] === true,
    [byId, status],
  )
  return { ready: status === 'ready', status, enabled }
}
