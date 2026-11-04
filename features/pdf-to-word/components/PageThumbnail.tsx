'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

interface PageThumbnailProps {
  geometry: { width: number; height: number; padX: number; padY: number }
  children: ReactNode
}

/** Scale the real page content, not a synthetic summary of its blocks. */
export default function PageThumbnail({ geometry, children }: PageThumbnailProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [pageHeight, setPageHeight] = useState(geometry.height)

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const measure = () => setPageHeight(Math.max(geometry.height, content.offsetHeight))
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(content)
    content.addEventListener('load', measure, true)
    return () => {
      observer?.disconnect()
      content.removeEventListener('load', measure, true)
    }
  }, [geometry.width, geometry.height, geometry.padX, geometry.padY])

  return (
    <div
      className="p2w-thumb-page"
      aria-hidden="true"
      style={{
        aspectRatio: `${geometry.width} / ${pageHeight}`,
        '--p2w-thumb-source-width': geometry.width,
      } as CSSProperties}
    >
      <div
        className="p2w-thumb-content"
        ref={contentRef}
        style={{
          width: geometry.width,
          minHeight: geometry.height,
          padding: `${geometry.padY}px ${geometry.padX}px`,
        }}
      >
        {children}
      </div>
    </div>
  )
}
