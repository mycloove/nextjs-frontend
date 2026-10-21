'use client'

import { useEffect, useRef } from 'react'

/* ═══════════════════════════════════════════════════════════════════
   Kinetic Sphere

   A field of uniformly sized dots spread across a sphere and rotated
   around a tilted axis. Because every dot is the same size and opacity,
   there is no depth cue — the rotation direction reads as ambiguous and
   the sphere appears to shimmer in place. That is the intended effect:
   an indeterminate loader that moves without ever claiming a percentage.

   · Points come from a Fibonacci lattice so the surface is even.
   · Dots inherit the element's CSS `color`, so the sphere adapts to any
     surface (button text, muted label, accent) with no colour props.
   · DPR-aware canvas keeps the dots crisp on retina displays.
   · `prefers-reduced-motion` renders one static, still-legible frame.
   ═══════════════════════════════════════════════════════════════════ */

type KineticSphereProps = {
  /** Rendered size in CSS pixels (square). */
  size?: number
  /** Number of dots distributed across the sphere. */
  points?: number
  /** Dot radius in CSS pixels. Defaults to a size-proportional value. */
  dot?: number
  /** Rotation step per frame — larger spins faster. */
  speed?: number
  /** Tilt of the rotation axis, in radians. */
  tilt?: number
  className?: string
  /** Accessible label. Omit to render the sphere as decorative. */
  label?: string
}

export default function KineticSphere({
  size = 44,
  points = 70,
  dot,
  speed = 0.035,
  tilt = 0.4,
  className,
  label,
}: KineticSphereProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)

    const color = getComputedStyle(canvas).color || 'rgb(255, 255, 255)'
    const radius = size * 0.3636
    const dotRadius = dot ?? Math.max(0.6, size * 0.02)
    const cx = size / 2
    const cy = size / 2

    const P: [number, number, number][] = []
    for (let i = 0; i < points; i++) {
      const y = 1 - (2 * (i + 0.5)) / points
      const r = Math.sqrt(Math.max(0, 1 - y * y))
      const a = i * 2.39996
      P.push([Math.cos(a) * r, y, Math.sin(a) * r])
    }

    const ct = Math.cos(tilt)
    const st = Math.sin(tilt)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let frame = 0
    let t = reduce ? 0.6 : 0

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size, size)
      ctx.fillStyle = color
      const c = Math.cos(t)
      const s = Math.sin(t)
      for (let i = 0; i < P.length; i++) {
        const p = P[i]
        const x = p[0] * c + p[2] * s
        const z = -p[0] * s + p[2] * c
        const y = p[1] * ct - z * st
        ctx.beginPath()
        ctx.arc(cx + x * radius, cy + y * radius, dotRadius, 0, 6.283185)
        ctx.fill()
      }
      if (!reduce) {
        t += speed
        frame = requestAnimationFrame(draw)
      }
    }

    draw()
    return () => cancelAnimationFrame(frame)
  }, [size, points, dot, speed, tilt])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size, display: 'block' }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
