import type { DiagramBlock, DiagramRenderContext, DiagramRenderResult } from '../types'

export async function renderBrowserDiagram(block: DiagramBlock, context: DiagramRenderContext): Promise<DiagramRenderResult> {
  switch (block.engine) {
    case 'mermaid':
      return (await import('./mermaid')).renderMermaid(block, context)
    case 'graphviz':
      return (await import('./graphviz')).renderGraphviz(block, context)
    case 'wavedrom':
    case 'bitfield':
      return (await import('./wavedrom')).renderWaveDrom(block, context)
    case 'vega':
    case 'vega-lite':
      return (await import('./vega')).renderVega(block, context)
    case 'plotly':
      return (await import('./plotly')).renderPlotly(block, context)
    default:
      throw new Error(`${block.engine} does not have a browser renderer.`)
  }
}

export async function renderDiagram(block: DiagramBlock, context: DiagramRenderContext): Promise<DiagramRenderResult> {
  switch (block.engine) {
    case 'plantuml':
    case 'd2':
    case 'tikz':
    case 'wsd':
    case 'kroki':
    case 'ditaa':
      return (await import('./server')).renderServerDiagram(block, context)
    default:
      return renderBrowserDiagram(block, context)
  }
}