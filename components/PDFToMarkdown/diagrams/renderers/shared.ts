import { sanitizeDiagramMarkup } from '../sanitize'
import type { DiagramRenderResult } from '../types'

export function svgResult(svg: string): DiagramRenderResult {
  return { kind: 'svg', content: sanitizeDiagramMarkup(svg) }
}

export function imageResult(content: string, mimeType: string): DiagramRenderResult {
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(content)) {
    throw new Error('The diagram service returned an invalid image payload.')
  }
  return { kind: 'image', content, mimeType }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Diagram rendering was cancelled.', 'AbortError')
}