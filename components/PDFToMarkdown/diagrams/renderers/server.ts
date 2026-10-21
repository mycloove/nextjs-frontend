import type { DiagramBlock, DiagramRenderContext, DiagramRenderResult } from '../types'
import { getServerCapability, invalidateServerCapabilities } from '../server-capabilities'
import { imageResult, svgResult, throwIfAborted } from './shared'

type RenderResponse = { kind?: unknown; content?: unknown; mimeType?: unknown; error?: unknown }

export async function renderServerDiagram(block: DiagramBlock, context: DiagramRenderContext): Promise<DiagramRenderResult> {
  throwIfAborted(context.signal)
  const capability = await getServerCapability(block.engine).catch(() => null)
  throwIfAborted(context.signal)
  if (capability?.available === false) {
    throw new Error(capability.reason || `${block.engine} rendering is unavailable.`)
  }
  const response = await fetch('/api/diagrams/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine: block.engine, language: block.language, source: block.source, attributes: block.attributes }),
    signal: context.signal,
  })
  const payload = await response.json().catch(() => ({})) as RenderResponse
  if (!response.ok) {
    if (response.status === 503) invalidateServerCapabilities()
    throw new Error(typeof payload.error === 'string' ? payload.error : `${block.engine} rendering is unavailable.`)
  }
  if (typeof payload.content !== 'string') throw new Error('The diagram service returned an invalid response.')
  if (payload.kind === 'svg') return svgResult(payload.content)
  if (payload.kind === 'image' && typeof payload.mimeType === 'string') return imageResult(payload.content, payload.mimeType)
  throw new Error('The diagram service returned an unsupported output format.')
}