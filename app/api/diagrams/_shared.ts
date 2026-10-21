import type {
  DiagramAttributes,
  DiagramEngine,
  DiagramEngineCapability,
} from '@/components/PDFToMarkdown/diagrams/types'

export const SERVER_ENGINES = new Set<DiagramEngine>(['plantuml', 'd2', 'tikz', 'wsd', 'kroki', 'ditaa'])

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.trunc(parsed))) : fallback
}

export const SOURCE_LIMIT = boundedInteger(process.env.DIAGRAM_MAX_SOURCE_BYTES, 200_000, 1_024, 1_000_000)
export const OUTPUT_LIMIT = boundedInteger(process.env.DIAGRAM_MAX_OUTPUT_BYTES, 4_000_000, 16_384, 20_000_000)
export const RENDER_TIMEOUT = boundedInteger(process.env.DIAGRAM_RENDER_TIMEOUT_MS, 15_000, 1_000, 60_000)

export type ServerDiagramRequest = {
  engine: DiagramEngine
  language: string
  source: string
  attributes: DiagramAttributes
}

export type ServerDiagramResult = {
  kind: 'svg' | 'image'
  content: string
  mimeType?: string
}

type DiagramServiceCapabilities = { engines?: DiagramEngineCapability[] }

function configuredUrl(name: 'KROKI_SERVER_URL' | 'PLANTUML_SERVER_URL' | 'WSD_ENDPOINT'): URL | null {
  const raw = process.env[name]?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function diagramServiceUrl(path: string): URL | null {
  const raw = process.env.DIAGRAM_SERVICE_URL?.trim()
  if (!raw) return null
  try {
    const base = new URL(raw)
    if (base.protocol !== 'http:' && base.protocol !== 'https:') return null
    return new URL(`${base.pathname.replace(/\/$/, '')}${path}`, base)
  } catch {
    return null
  }
}

export function serverCapabilities(): DiagramEngineCapability[] {
  const kroki = Boolean(configuredUrl('KROKI_SERVER_URL'))
  const plantUml = Boolean(configuredUrl('PLANTUML_SERVER_URL')) || kroki
  const wsd = Boolean(configuredUrl('WSD_ENDPOINT'))
  return [
    { engine: 'plantuml', runtime: 'server', available: plantUml, reason: plantUml ? undefined : 'Configure PLANTUML_SERVER_URL or KROKI_SERVER_URL.' },
    { engine: 'd2', runtime: 'server', available: kroki, reason: kroki ? undefined : 'Configure KROKI_SERVER_URL with D2 support.' },
    { engine: 'tikz', runtime: 'server', available: false, reason: 'TikZ requires a separately isolated renderer and remains source-only.' },
    { engine: 'ditaa', runtime: 'server', available: kroki, reason: kroki ? undefined : 'Configure KROKI_SERVER_URL with Ditaa support.' },
    { engine: 'kroki', runtime: 'remote', available: kroki, reason: kroki ? undefined : 'Configure KROKI_SERVER_URL.' },
    { engine: 'wsd', runtime: 'remote', available: wsd, reason: wsd ? undefined : 'Configure WSD_ENDPOINT.' },
  ]
}

export async function resolvedServerCapabilities(): Promise<DiagramEngineCapability[]> {
  const url = diagramServiceUrl('/v1/capabilities')
  if (!url) return serverCapabilities()
  try {
    const response = await requestRenderer(url, { method: 'GET', headers: { Accept: 'application/json' } })
    const payload = JSON.parse(new TextDecoder().decode(response.bytes)) as DiagramServiceCapabilities
    if (!Array.isArray(payload.engines)) throw new Error('Invalid capability response.')
    return payload.engines.filter((item) => SERVER_ENGINES.has(item.engine))
  } catch {
    return Array.from(SERVER_ENGINES, (engine) => ({
      engine,
      runtime: engine === 'kroki' || engine === 'wsd' ? 'remote' : 'server',
      available: false,
      reason: 'The diagram service is not ready.',
    }))
  }
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > OUTPUT_LIMIT) throw new Error('Diagram output exceeds the configured size limit.')
  if (!response.body) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > OUTPUT_LIMIT) {
      await reader.cancel()
      throw new Error('Diagram output exceeds the configured size limit.')
    }
    chunks.push(value)
  }

  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

async function requestRenderer(url: URL, init: RequestInit): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(RENDER_TIMEOUT),
  })
  const bytes = await readBoundedResponse(response)
  if (!response.ok) {
    const detail = new TextDecoder().decode(bytes).replace(/\s+/g, ' ').slice(0, 240)
    throw new Error(`Renderer returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`)
  }
  return { bytes, contentType: response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '' }
}

function outputResult(bytes: Uint8Array, contentType: string): ServerDiagramResult {
  const prefix = new TextDecoder().decode(bytes.slice(0, 256))
  if (contentType === 'image/svg+xml' || prefix.includes('<svg')) {
    return { kind: 'svg', content: new TextDecoder().decode(bytes) }
  }
  if (contentType === 'image/png' || contentType === 'image/jpeg' || contentType === 'image/webp') {
    return { kind: 'image', content: `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`, mimeType: contentType }
  }
  throw new Error('Renderer returned an unsupported output format.')
}

const KROKI_TYPES = new Set([
  'actdiag', 'blockdiag', 'bpmn', 'bytefield', 'c4plantuml', 'ditaa', 'd2', 'dbml',
  'erd', 'excalidraw', 'graphviz', 'mermaid', 'nomnoml', 'nwdiag', 'packetdiag',
  'pikchr', 'plantuml', 'rackdiag', 'seqdiag', 'structurizr', 'svgbob', 'symbolator',
  'umlet', 'vega', 'vegalite', 'wavedrom', 'wireviz',
])

function krokiType(request: ServerDiagramRequest): string {
  if (request.engine !== 'kroki') return request.engine
  const requested = typeof request.attributes.kroki === 'string' ? request.attributes.kroki : request.language
  const normalized = requested.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!KROKI_TYPES.has(normalized)) throw new Error('This Kroki diagram type is not allowlisted.')
  return normalized
}

async function renderWithKroki(request: ServerDiagramRequest): Promise<ServerDiagramResult> {
  const base = configuredUrl('KROKI_SERVER_URL')
  if (!base) throw new Error('Kroki rendering is not configured.')
  const type = krokiType(request)
  const url = new URL(`${base.pathname.replace(/\/$/, '')}/${type}/svg`, base)
  const response = await requestRenderer(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8', Accept: 'image/svg+xml' },
    body: request.source,
  })
  return outputResult(response.bytes, response.contentType)
}

async function renderPlantUml(request: ServerDiagramRequest): Promise<ServerDiagramResult> {
  const base = configuredUrl('PLANTUML_SERVER_URL')
  if (!base) return renderWithKroki(request)
  const source = /@start\w+/i.test(request.source)
    ? request.source
    : `@startuml\n${request.source}\n@enduml`
  const path = base.pathname.replace(/\/$/, '')
  const url = new URL(path.endsWith('/svg') ? path : `${path}/svg`, base)
  const response = await requestRenderer(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8', Accept: 'image/svg+xml' },
    body: source,
  })
  return outputResult(response.bytes, response.contentType)
}

async function renderWsd(request: ServerDiagramRequest): Promise<ServerDiagramResult> {
  const endpoint = configuredUrl('WSD_ENDPOINT')
  if (!endpoint) throw new Error('WebSequenceDiagrams rendering is not configured.')
  const apiKey = process.env.WSD_API_KEY?.trim()
  // WSD requires a style, and SVG rendering is a premium API-key feature.
  // PNG keeps WebSequenceDiagrams usable with the public endpoint.
  const form = new URLSearchParams({
    message: request.source,
    style: process.env.WSD_STYLE?.trim() || 'default',
    apiVersion: '1',
    format: apiKey ? 'svg' : 'png',
  })
  if (apiKey) form.set('apikey', apiKey)
  const response = await requestRenderer(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json, image/svg+xml, image/png' },
    body: form,
  })
  if (response.contentType.startsWith('image/')) return outputResult(response.bytes, response.contentType)

  const payload = JSON.parse(new TextDecoder().decode(response.bytes)) as { img?: unknown; content?: unknown }
  if (typeof payload.content === 'string' && payload.content.trimStart().startsWith('<svg')) {
    return { kind: 'svg', content: payload.content }
  }
  if (typeof payload.img !== 'string') throw new Error('WebSequenceDiagrams returned an invalid response.')
  const imageUrl = new URL(payload.img, endpoint)
  if (imageUrl.origin !== endpoint.origin) throw new Error('WebSequenceDiagrams returned an untrusted image URL.')
  const image = await requestRenderer(imageUrl, { method: 'GET', headers: { Accept: 'image/svg+xml, image/png' } })
  return outputResult(image.bytes, image.contentType)
}

async function renderWithDiagramService(request: ServerDiagramRequest): Promise<ServerDiagramResult> {
  const url = diagramServiceUrl('/v1/render')
  if (!url) throw new Error('Diagram rendering is not configured.')
  const response = await requestRenderer(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(request),
  })
  const payload = JSON.parse(new TextDecoder().decode(response.bytes)) as Partial<ServerDiagramResult>
  if (payload.kind === 'svg' && typeof payload.content === 'string') return payload as ServerDiagramResult
  if (payload.kind === 'image' && typeof payload.content === 'string' && typeof payload.mimeType === 'string') {
    return payload as ServerDiagramResult
  }
  throw new Error('The diagram service returned an invalid response.')
}

export async function renderServerDiagram(request: ServerDiagramRequest): Promise<ServerDiagramResult> {
  if (diagramServiceUrl('/v1/render')) return renderWithDiagramService(request)
  if (request.engine === 'plantuml') return renderPlantUml(request)
  if (request.engine === 'wsd') return renderWsd(request)
  if (request.engine === 'kroki' || request.engine === 'd2' || request.engine === 'ditaa') return renderWithKroki(request)
  throw new Error('TikZ requires an isolated renderer and is not enabled on this server.')
}
