'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import { computeAutoScrollVelocity } from './dragAutoScroll'

/* Tuned so a drag across a long stack feels controlled: fast enough to cross
   forty sheets in a few seconds, slow enough to stop on the right one. */
const MAX_SPEED = 18
const EDGE_ZONE = 88

/**
 * Drives horizontal auto-scroll on a scrollable strip while an HTML5 drag is in
 * progress. The velocity comes from `computeAutoScrollVelocity`; this hook owns
 * only the requestAnimationFrame loop and the drag lifecycle.
 *
 * `ref` goes on the scroll container, `onDragOver` on the same element (it also
 * calls preventDefault so the strip stays a valid drop target), and `stop` on
 * `onDragEnd`/`onDrop`/an outside `onDragLeave` so the loop can never keep
 * scrolling after the pointer has left or the drag has ended.
 */
export function useHorizontalDragAutoScroll(maxSpeed = MAX_SPEED, edgeZone = EDGE_ZONE) {
  const ref = useRef<HTMLDivElement | null>(null)
  const velocityRef = useRef(0)
  const frameRef = useRef<number | null>(null)
  /* The frame step lives in a ref so it can schedule its own next frame without
     a self-referencing const (which the hooks lint rule rejects). */
  const stepRef = useRef<() => void>(() => {})

  useEffect(() => {
    stepRef.current = () => {
      const el = ref.current
      if (!el || velocityRef.current === 0) {
        frameRef.current = null
        return
      }
      el.scrollLeft += velocityRef.current
      frameRef.current = requestAnimationFrame(() => stepRef.current())
    }
  }, [])

  const stop = useCallback(() => {
    velocityRef.current = 0
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  const onDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault()
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      velocityRef.current = computeAutoScrollVelocity(event.clientX, rect, maxSpeed, edgeZone)
      if (velocityRef.current !== 0 && frameRef.current === null) {
        frameRef.current = requestAnimationFrame(() => stepRef.current())
      }
    },
    [maxSpeed, edgeZone]
  )

  useEffect(() => stop, [stop])

  return { ref, onDragOver, stop }
}
