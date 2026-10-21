'use client'

import { useEffect, useRef } from 'react'

/**
 * Kinetic Sphere — the Bijoy → Unicode decode loader (LoaderUI/loader-6-kinetic-sphere).
 *
 * A shell of uniform dots on a rotating sphere with no size/depth shading, so
 * the rotation direction reads as ambiguous — a fitting "something is being
 * worked out" state with no fake progress (Astrolabe doctrine 5: an honest
 * indeterminate state beats a fabricated percentage). Ported from the canvas
 * reference; the dot colour is inherited from CSS so the sphere is the tool's
 * gold accent in both themes.
 *
 * The geometry is derived from the rendered `size` (not the reference's fixed
 * 88px box): a fixed backing store scaled down to a 16–20px button loader
 * collapsed every dot to a sub-pixel smudge. Dot radius, sphere radius and dot
 * count now scale with `size`, so the mark stays legible from a 20px button to
 * the large overlay.
 */
export default function KineticSphereLoader({ size = 54, color = 'var(--b2u-accent)' }: { size?: number; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const S = size
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(S * dpr)
    canvas.height = Math.round(S * dpr)
    ctx.scale(dpr, dpr)

    const dotColor = getComputedStyle(canvas).color || '#e6b64c'

    const center = S / 2
    const sphereR = S * 0.42
    const dotR = Math.min(2, Math.max(1.1, S * 0.05))

    // Fibonacci-distributed points on a unit sphere. Fewer dots as the mark
    // shrinks, so the shell reads as a sphere instead of merging into a blob.
    const N = Math.max(14, Math.min(64, Math.round(S * 1.15)))
    const points: Array<[number, number, number]> = []
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * (i + 0.5)) / N
      const r = Math.sqrt(Math.max(0, 1 - y * y))
      const a = i * 2.39996
      points.push([Math.cos(a) * r, y, Math.sin(a) * r])
    }

    const tilt = Math.cos(0.4)
    const tiltSin = Math.sin(0.4)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let t = 0
    let raf = 0
    const draw = () => {
      ctx.clearRect(0, 0, S, S)
      t += 0.035
      const c = Math.cos(t)
      const s = Math.sin(t)
      ctx.fillStyle = dotColor
      for (const p of points) {
        const x = p[0] * c + p[2] * s
        const z = -p[0] * s + p[2] * c
        const y = p[1] * tilt - z * tiltSin
        ctx.beginPath()
        ctx.arc(center + x * sphereR, center + y * sphereR, dotR, 0, 6.283)
        ctx.fill()
      }
      if (!reduce) raf = requestAnimationFrame(draw)
    }
    draw()

    return () => cancelAnimationFrame(raf)
  }, [size])

  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size, display: 'block', color }}
      aria-hidden="true"
    />
  )
}
