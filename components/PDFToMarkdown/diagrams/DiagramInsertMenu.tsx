'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DIAGRAM_TEMPLATES } from './registry'
import { getServerCapabilities } from './server-capabilities'
import type { DiagramEngineCapability, DiagramTemplate } from './types'
import './diagram-preview.css'

type DiagramInsertMenuProps = {
  open: boolean
  anchorRect?: DOMRect | null
  onPick: (template: DiagramTemplate) => void
  onClose: () => void
}

export function DiagramInsertMenu({ open, anchorRect, onPick, onClose }: DiagramInsertMenuProps) {
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const [menuLayout, setMenuLayout] = useState<{ top: number; left: number; maxHeight: number; openAbove: boolean } | null>(null)
  const [capabilities, setCapabilities] = useState<Record<string, DiagramEngineCapability>>({})

  const [capabilityState, setCapabilityState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [capabilityAttempt, setCapabilityAttempt] = useState(0)
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return DIAGRAM_TEMPLATES
    return DIAGRAM_TEMPLATES.filter((item) => `${item.label} ${item.engine} ${item.description}`.toLowerCase().includes(normalized))
  }, [query])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const onDown = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose() }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    let active = true
    getServerCapabilities(true)
      .then((items) => {
        if (!active) return
        setCapabilities(Object.fromEntries(items))
        setCapabilityState('ready')
      })
      .catch(() => {
        if (!active) return
        setCapabilities({})
        setCapabilityState('error')
      })
    return () => { active = false }
  }, [capabilityAttempt, open])

  useLayoutEffect(() => {
    if (!open || !anchorRect) return

    const VIEWPORT_PADDING = 12
    const ANCHOR_GAP = 7

    const updatePosition = () => {
      const menu = rootRef.current
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      // Space available on each side of the anchor, respecting the gutter.
      const roomBelow = viewportHeight - anchorRect.bottom - ANCHOR_GAP - VIEWPORT_PADDING
      const roomAbove = anchorRect.top - ANCHOR_GAP - VIEWPORT_PADDING

      // Prefer opening below the trigger (matches the non-focus behaviour).
      // Only flip above when there is genuinely more usable room there.
      const openAbove = roomBelow < 240 && roomAbove > roomBelow
      const side = openAbove ? roomAbove : roomBelow
      const availableHeight = Math.max(200, Math.min(side, viewportHeight - VIEWPORT_PADDING * 2))

      // Natural height of the menu, capped to the space on the chosen side so
      // the internal list scrolls instead of spilling past the viewport edge.
      const naturalHeight = menu?.offsetHeight || 430
      const maxHeight = Math.min(naturalHeight, availableHeight)
      const menuWidth = menu?.offsetWidth || Math.min(336, viewportWidth - VIEWPORT_PADDING * 2)

      const rawTop = openAbove
        ? anchorRect.top - maxHeight - ANCHOR_GAP
        : anchorRect.bottom + ANCHOR_GAP
      // Final clamp guarantees the whole menu (top *and* bottom) stays inside
      // the viewport regardless of where the trigger sits (e.g. focus mode).
      const top = Math.min(
        Math.max(VIEWPORT_PADDING, rawTop),
        viewportHeight - maxHeight - VIEWPORT_PADDING,
      )
      const left = Math.max(
        VIEWPORT_PADDING,
        Math.min(anchorRect.left, viewportWidth - menuWidth - VIEWPORT_PADDING),
      )

      setMenuLayout({ top: Math.max(VIEWPORT_PADDING, top), left, maxHeight, openAbove })
    }

    updatePosition()

    // Re-measure once the menu content (and lazily-loaded capability rows)
    // settle, so the height cap and clamp always reflect the real layout.
    const observer =
      typeof ResizeObserver !== 'undefined' && rootRef.current
        ? new ResizeObserver(() => updatePosition())
        : null
    if (observer && rootRef.current) observer.observe(rootRef.current)

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRect, open, results.length, capabilityState])

  // Render through a portal so the menu is always measured and positioned
  // against the true viewport. Focus mode animates a `transform` on the editor
  // pane, which would otherwise become the containing block for this fixed
  // element and push the dropdown below the viewport edge. We portal into the
  // themed workspace root (never `document.body`) so the scoped CSS variables
  // (--accent, --surface, --line, data-theme…) keep resolving and the visual
  // design stays identical in both light and dark themes.
  if (!open || typeof document === 'undefined') return null

  const portalTarget = document.querySelector('.mr-markdown-workspace') ?? document.body

  const rect = anchorRect
  // Until the first measurement lands, keep the menu invisible so it never
  // flashes outside the viewport (previously the raw fallback could overflow).
  const style: React.CSSProperties = menuLayout
    ? {
        top: menuLayout.top,
        left: menuLayout.left,
        maxHeight: menuLayout.maxHeight,
        transformOrigin: menuLayout.openAbove ? 'bottom left' : 'top left',
      }
    : {
        top: rect ? Math.max(12, Math.min(rect.bottom + 7, window.innerHeight - 12)) : 100,
        left: rect ? Math.max(12, Math.min(rect.left, window.innerWidth - 362)) : 100,
        visibility: 'hidden',
        pointerEvents: 'none',
      }


  return createPortal(
    <div ref={rootRef} className="mr-diagram-insert-menu" style={style} role="dialog" aria-modal="false" aria-label="Insert diagram">
      <div className="mr-diagram-insert-head">
        <strong>Insert diagram</strong>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search engines" aria-label="Search diagram engines" autoFocus />
      </div>
      <div className="mr-diagram-insert-list">
        {results.map((item) => {
          const serverRendered = item.runtime !== 'browser'
          const capability = capabilities[item.engine]
          const checking = serverRendered && (capabilityState === 'idle' || capabilityState === 'loading')
          const unavailable = serverRendered && (capabilityState === 'error' || capability?.available === false)
          const available = serverRendered && capabilityState === 'ready' && capability?.available === true
          const status = checking
            ? 'Checking'
            : unavailable
              ? 'Unavailable'
              : available
                ? capability.runtime
                : item.runtime
          const reason = capability?.reason || (capabilityState === 'error' ? 'Renderer status could not be loaded. Retry the check.' : undefined)
          return (
          <button key={item.engine} type="button" className="mr-diagram-insert-item" onClick={() => onPick(item)} title={unavailable ? reason : undefined}>
            <span className="mr-diagram-insert-engine">{item.engine}</span>
            <span className="mr-diagram-insert-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
            <span className={`mr-diagram-runtime${checking ? ' is-checking' : ''}${available ? ' is-available' : ''}${unavailable ? ' is-unavailable' : ''}`}>{status}</span>
          </button>
          )
        })}
        {!results.length && <div className="mr-diagram-insert-empty">No diagram engines match.</div>}
      </div>
      <div className="mr-diagram-insert-foot">
        <span>Templates insert as editable Markdown fences.</span>
        {capabilityState === 'error' || Object.values(capabilities).some((item) => !item.available) ? (
          <button type="button" onClick={() => {
            setCapabilityState('loading')
            setCapabilityAttempt((value) => value + 1)
          }}>Retry status</button>
        ) : null}
      </div>
    </div>,
    portalTarget,
  )
}
