import type { DiagramBlock, DiagramRenderContext, DiagramRenderResult } from '../types'
import { svgResult, throwIfAborted } from './shared'

const GRAPHVIZ_ENGINES = new Set(['circo', 'dot', 'neato', 'osage', 'twopi'])

export async function renderGraphviz(block: DiagramBlock, context: DiagramRenderContext): Promise<DiagramRenderResult> {
  throwIfAborted(context.signal)
  const requested = String(block.attributes.engine ?? 'dot').toLowerCase()
  const engine = GRAPHVIZ_ENGINES.has(requested) ? requested : 'dot'
  const { instance } = await import('@viz-js/viz')
  const viz = await instance()
  throwIfAborted(context.signal)
  const svg = viz.renderString(block.source, { format: 'svg', engine })
  return svgResult(svg)
}