'use client'

import { useEffect, useState, type ReactNode } from 'react'
import WithdrawnTool from './WithdrawnTool'

export default function ToolRouteGate({
  toolId,
  label,
  children,
}: {
  toolId: string
  label: string
  children: ReactNode
}) {
  const [state, setState] = useState<'pending' | 'open' | 'closed'>('pending')

  useEffect(() => {
    let cancelled = false
    fetch('/api/tools/availability', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() as Promise<{ tools?: { tool_id?: string; enabled?: boolean }[] }> : null)
      .then((payload) => {
        if (cancelled) return
        const row = payload?.tools?.find((tool) => tool.tool_id === toolId)
        setState(row && row.enabled === false ? 'closed' : 'open')
      })
      .catch(() => {
        if (!cancelled) setState('open')
      })
    return () => {
      cancelled = true
    }
  }, [toolId])

  if (state === 'closed') return <WithdrawnTool label={label} />
  if (state === 'pending') return null
  return children
}
