'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'

/**
 * PDF Editor cannot import @/ components. This gate asks the shared
 * availability route and, when the bench has withdrawn the editor, replaces
 * the workspace. A failed read leaves the editor open; the API still refuses
 * a withdrawn tool.
 */
export default function ServiceGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'pending' | 'open' | 'closed'>('pending')

  useEffect(() => {
    let cancelled = false
    fetch('/api/tools/availability', { cache: 'no-store' })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload: { tools?: { tool_id?: string; enabled?: boolean }[] } | null) => {
        if (cancelled) return
        const row = payload?.tools?.find((tool) => tool.tool_id === 'pdf-editor')
        setState(row && row.enabled === false ? 'closed' : 'open')
      })
      .catch(() => {
        if (!cancelled) setState('open')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'pending') return null
  if (state === 'closed') {
    return (
      <div style={{
        background: 'var(--bg-page)',
        color: 'var(--text-primary)',
        margin: '18vh auto 0',
        maxWidth: '36rem',
        padding: '0 24px',
      }}>
        <p style={{
          color: 'var(--brand-red)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.12em',
          margin: '0 0 10px',
          textTransform: 'uppercase',
        }}>Withdrawn</p>
        <h1 style={{ fontSize: 'clamp(32px, 5vw, 48px)', letterSpacing: '-0.045em', lineHeight: 0.95, margin: '0 0 14px' }}>
          PDF Editor is off the bench
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 15, maxWidth: '42ch' }}>
          An admin closed this instrument. It stays out of the library until they open it again.
        </p>
        <Link href="/" style={{ color: 'var(--text-primary)', display: 'inline-block', fontSize: 13, marginTop: 22 }}>
          Back to the tools
        </Link>
      </div>
    )
  }
  return children
}
