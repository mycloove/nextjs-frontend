'use client'

import Image from 'next/image'
import { useEffect, useRef, type RefObject } from 'react'

import styles from './AnimatedBrandLogo.module.css'

type AnimatedBrandLogoProps = {
  className?: string
  /**
   * Alternate artwork path. Only a colour swap — the render has the identical
   * frame, so the blinking-eye overlay positions keep working untouched.
   * Defaults to the orange brand-v2 octopus, the canonical mark everywhere.
   */
  src?: string
  /**
   * Optional element whose surface drives the eye/tilt tracking. Defaults to
   * the logo itself, so the eyes only follow the cursor while it hovers the
   * mark (the marketing-shell behaviour). Surfaces that want the eyes to
   * follow the cursor across a whole page — e.g. the PDF editor drop zone —
   * pass a ref to their root element instead. Everything else (clamping,
   * eased follow, reduced-motion reset) is unchanged.
   */
  trackingAreaRef?: RefObject<HTMLElement | null>
}

export default function AnimatedBrandLogo({ className = '', src = '/animated-brand-logo-orange.png', trackingAreaRef }: AnimatedBrandLogoProps) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const faceRef = useRef<HTMLSpanElement>(null)
  const leftEyeSlotRef = useRef<HTMLSpanElement>(null)
  const rightEyeSlotRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const container = containerRef.current
    const face = faceRef.current
    const leftEyeSlot = leftEyeSlotRef.current
    const rightEyeSlot = rightEyeSlotRef.current
    if (!container || !face || !leftEyeSlot || !rightEyeSlot) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frameId = 0
    let isTracking = false
    const current = { tiltX: 0, tiltY: 0, eyeX: 0, eyeY: 0 }
    const target = { tiltX: 0, tiltY: 0, eyeX: 0, eyeY: 0 }

    const stopFrame = () => {
      if (!frameId) return
      cancelAnimationFrame(frameId)
      frameId = 0
    }

    const render = () => {
      current.tiltX += (target.tiltX - current.tiltX) * 0.18
      current.tiltY += (target.tiltY - current.tiltY) * 0.18
      current.eyeX += (target.eyeX - current.eyeX) * 0.24
      current.eyeY += (target.eyeY - current.eyeY) * 0.24

      face.style.transform = `rotateX(${current.tiltX.toFixed(2)}deg) rotateY(${current.tiltY.toFixed(2)}deg)`
      leftEyeSlot.style.transform = `translate3d(${current.eyeX.toFixed(2)}px, ${current.eyeY.toFixed(2)}px, 0)`
      rightEyeSlot.style.transform = `translate3d(${current.eyeX.toFixed(2)}px, ${current.eyeY.toFixed(2)}px, 0)`

      const settled =
        Math.abs(target.tiltX - current.tiltX) < 0.01 &&
        Math.abs(target.tiltY - current.tiltY) < 0.01 &&
        Math.abs(target.eyeX - current.eyeX) < 0.01 &&
        Math.abs(target.eyeY - current.eyeY) < 0.01

      if (isTracking || !settled) {
        frameId = requestAnimationFrame(render)
      } else {
        frameId = 0
      }
    }

    const startFrame = () => {
      if (!frameId) frameId = requestAnimationFrame(render)
    }

    const updateLogo = (event: PointerEvent) => {
      if (reduceMotion.matches) return

      const bounds = container.getBoundingClientRect()
      const x = event.clientX - bounds.left
      const y = event.clientY - bounds.top
      const centerX = bounds.width / 2
      const centerY = bounds.height / 2
      const normalizedX = Math.max(-1, Math.min(1, (x - centerX) / centerX))
      const normalizedY = Math.max(-1, Math.min(1, (y - centerY) / centerY))
      const eyeScale = bounds.width / 180

      isTracking = true
      container.classList.add(styles.isTracking)
      target.tiltX = normalizedY * -8
      target.tiltY = normalizedX * 8
      target.eyeX = Math.max(-5, Math.min(5, normalizedX * 5)) * eyeScale
      target.eyeY = Math.max(-4, Math.min(4, normalizedY * 4)) * eyeScale
      startFrame()
    }

    const resetLogo = () => {
      isTracking = false
      container.classList.remove(styles.isTracking)
      target.tiltX = 0
      target.tiltY = 0
      target.eyeX = 0
      target.eyeY = 0
      startFrame()
    }

    const handleMotionPreference = () => {
      if (!reduceMotion.matches) return
      stopFrame()
      isTracking = false
      container.classList.remove(styles.isTracking)
      current.tiltX = 0
      current.tiltY = 0
      current.eyeX = 0
      current.eyeY = 0
      target.tiltX = 0
      target.tiltY = 0
      target.eyeX = 0
      target.eyeY = 0
      face.removeAttribute('style')
      leftEyeSlot.removeAttribute('style')
      rightEyeSlot.removeAttribute('style')
    }

    // The tracking surface defaults to the logo's own container (hover-only),
    // but a page can widen it (e.g. the whole drop zone) via trackingAreaRef.
    // Move/leave belong to that surface; the up/cancel reset stays on the
    // logo container so a click elsewhere on a wide surface never snaps the
    // eyes back to centre.
    const trackingArea = trackingAreaRef?.current ?? container

    trackingArea.addEventListener('pointermove', updateLogo)
    trackingArea.addEventListener('pointerleave', resetLogo)
    container.addEventListener('pointercancel', resetLogo)
    container.addEventListener('pointerup', resetLogo)
    reduceMotion.addEventListener('change', handleMotionPreference)
    return () => {
      stopFrame()
      trackingArea.removeEventListener('pointermove', updateLogo)
      trackingArea.removeEventListener('pointerleave', resetLogo)
      container.removeEventListener('pointercancel', resetLogo)
      container.removeEventListener('pointerup', resetLogo)
      reduceMotion.removeEventListener('change', handleMotionPreference)
    }
  }, [])

  return (
    <span
      ref={containerRef}
      className={`${styles.container} ${className}`.trim()}
      aria-hidden="true"
    >
      <span className={styles.wrapper}>
        <span ref={faceRef} className={styles.face}>
          {/*
            The artwork is 180px but the mark renders at 42px (36px under
            640px). Without this hint the browser assumes 100vw and pulls the
            largest candidate, so every surface that mounts this logo
            over-fetched ~4x on the viewport most people arrive on.
          */}
          <Image
            className={styles.image}
            src={src}
            alt=""
            width={180}
            height={180}
            sizes="(max-width: 640px) 36px, 42px"
            priority
            draggable={false}
          />
          <span className={styles.eyes}>
            <span ref={leftEyeSlotRef} className={`${styles.eyeSlot} ${styles.eyeLeft}`}>
              <span className={styles.eye} />
            </span>
            <span ref={rightEyeSlotRef} className={`${styles.eyeSlot} ${styles.eyeRight}`}>
              <span className={styles.eye} />
            </span>
          </span>
        </span>
      </span>
    </span>
  )
}
