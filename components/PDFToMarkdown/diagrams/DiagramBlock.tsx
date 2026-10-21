'use client'

import { useEffect, useRef, useState } from 'react'
import { getDiagramCapability } from './registry'
import { renderDiagramCached } from './render-cache'
import type { DiagramBlock as DiagramBlockData, DiagramRenderResult } from './types'
import './diagram-preview.css'

type DiagramBlockProps = {
  block: DiagramBlockData
  theme: 'light' | 'dark'
}

export function DiagramBlock({ block, theme }: DiagramBlockProps) {
  const rootRef = useRef<HTMLElement>(null)
  const interactiveHostRef = useRef<HTMLDivElement>(null)
  const interactiveFinalizeRef = useRef<(() => void) | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [visible, setVisible] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [result, setResult] = useState<DiagramRenderResult | null>(null)
  const [error, setError] = useState('')
  const capability = getDiagramCapability(block.engine)
  const isInteractiveVega = block.engine === 'vega' || block.engine === 'vega-lite'

  useEffect(() => {
    const target = rootRef.current
    if (!target || typeof IntersectionObserver === 'undefined') {
      const frame = window.requestAnimationFrame(() => setVisible(true))
      return () => window.cancelAnimationFrame(frame)
    }
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true) },
      { rootMargin: '240px 0px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || block.attributes.code_block === true) return
    const controller = new AbortController()
    const interactiveHost = interactiveHostRef.current
    const timer = window.setTimeout(() => {
      setState('loading')
      setError('')
      if (isInteractiveVega) {
        import('./renderers/vega')
          .then(({ renderInteractiveVega }) => {
            if (!interactiveHost) throw new Error('Vega preview host is unavailable.')
            interactiveHost.replaceChildren()
            return renderInteractiveVega(block, { theme, signal: controller.signal }, interactiveHost)
          })
          .then((finalize) => {
            if (controller.signal.aborted) {
              finalize()
              return
            }
            interactiveFinalizeRef.current = finalize
            setState('ready')
          })
          .catch((next: unknown) => {
            if (controller.signal.aborted) return
            setError(next instanceof Error ? next.message : 'Diagram rendering failed.')
            setState('error')
          })
      } else {
        renderDiagramCached(block, theme, controller.signal, attempt > 0)
          .then((next) => {
            if (controller.signal.aborted) return
            setResult(next)
            setState('ready')
          })
          .catch((next: unknown) => {
            if (controller.signal.aborted) return
            setError(next instanceof Error ? next.message : 'Diagram rendering failed.')
            setState('error')
          })
      }
    }, 400)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
      interactiveFinalizeRef.current?.()
      interactiveFinalizeRef.current = null
      interactiveHost?.replaceChildren()
    }
  }, [attempt, block, isInteractiveVega, theme, visible])

  const retry = () => {
    setResult(null)
    setError('')
    setState('loading')
    setAttempt((value) => value + 1)
  }

  if (block.attributes.code_block === true) {
    return <pre className="mr-diagram-code-only"><code>{block.source}</code></pre>
  }

  const requestedAlign = String(block.attributes.align ?? '').toLowerCase()
  const alignment = requestedAlign === 'left' || requestedAlign === 'center' || requestedAlign === 'right'
    ? requestedAlign
    : undefined

  return (
    <figure ref={rootRef} className="mr-diagram-block" data-engine={block.engine} data-state={state} data-align={alignment}>
      {state !== 'ready' ? (
        <figcaption className="mr-diagram-caption">
          <span>{capability.label}</span>
          {state === 'error' ? (
            <button type="button" onClick={retry} aria-label={`Retry ${capability.label} rendering`}>Retry</button>
          ) : null}
        </figcaption>
      ) : null}
      {state === 'idle' || state === 'loading' ? (
        <div className="mr-diagram-loading" role="status">Rendering {capability.label}...</div>
      ) : null}
      {isInteractiveVega && state !== 'error' ? (
        <div className="mr-diagram-output" aria-label={`${capability.label} diagram`}>
          <div ref={interactiveHostRef} />
        </div>
      ) : null}
      {!isInteractiveVega && state === 'ready' && result ? (
        result.kind === 'image'
          // Rendered data URLs come from local renderers or the allowlisted same-origin proxy.
          // eslint-disable-next-line @next/next/no-img-element
          ? <div className="mr-diagram-output"><img className="mr-diagram-image" src={result.content} alt={`${capability.label} diagram`} /></div>
          : <div className="mr-diagram-output" dangerouslySetInnerHTML={{ __html: result.content }} />
      ) : null}
      {state === 'error' ? (
        <div className="mr-diagram-fallback">
          <p>{error || `${capability.label} is not available in this preview yet.`}</p>
          <pre><code>{block.source}</code></pre>
        </div>
      ) : null}
    </figure>
  )
}
