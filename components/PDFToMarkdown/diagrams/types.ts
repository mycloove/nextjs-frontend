export type DiagramEngine =
  | 'mermaid' | 'plantuml' | 'wavedrom' | 'bitfield' | 'graphviz' | 'd2'
  | 'tikz' | 'wsd' | 'vega' | 'vega-lite' | 'kroki' | 'ditaa' | 'plotly'

export type DiagramAttributeValue = string | boolean
export type DiagramAttributes = Record<string, DiagramAttributeValue>

export type DiagramBlock = {
  id: string
  engine: DiagramEngine
  language: string
  source: string
  attributes: DiagramAttributes
  start: number
  end: number
}

export type DiagramCapability = {
  engine: DiagramEngine
  label: string
  runtime: 'browser' | 'server'
  available: boolean
  description: string
}

export type DiagramRenderResult = {
  kind: 'svg' | 'html' | 'image'
  content: string
  mimeType?: string
  width?: number
  height?: number
}

export type DiagramRenderContext = { theme: 'light' | 'dark'; signal: AbortSignal }

export type DiagramTemplate = {
  engine: DiagramEngine
  label: string
  language: string
  runtime: 'browser' | 'server' | 'remote'
  exportQuality: 'native' | 'raster' | 'source'
  description: string
  source: string
  attributes?: string
}

export type DiagramEngineCapability = {
  engine: DiagramEngine
  available: boolean
  runtime: DiagramTemplate['runtime']
  reason?: string
}