'use client'

import { useCallback, useEffect, useState } from 'react'
import type { UsageSnapshot } from './types'

export function useUsageSnapshot(toolId?: string) {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null)

  const refresh = useCallback(() => {
    const query = toolId ? `?tool=${encodeURIComponent(toolId)}` : ''
    fetch(`/api/usage${query}`, { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null
        return response.json() as Promise<UsageSnapshot>
      })
      .then((data) => {
        if (data && typeof data.remaining === 'number') setSnapshot(data)
      })
      .catch(() => {
        // The meter is status, not a blocking control.
      })
  }, [toolId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { snapshot, refresh }
}

export async function claimUsageAfterLogin() {
  await fetch('/api/usage', { method: 'POST', credentials: 'include', cache: 'no-store' }).catch(() => {
    // Mapping is retried on the next conversion.
  })
}
