import YAML from 'yaml'
import type { DiagramBlock, DiagramRenderContext, DiagramRenderResult } from '../types'
import { svgResult, throwIfAborted } from './shared'

// `plotly.js-dist-min` ships browser runtime code but no standalone type
// package. Keep this renderer structurally typed so production installs do not
// depend on the uninstalled `plotly.js` package.
type Data = Record<string, unknown>
type Layout = Record<string, unknown>
type Config = Record<string, unknown>
type PlotlySpec = { data?: Data[]; layout?: Partial<Layout>; config?: Partial<Config> }

function parsePlotlySpec(source: string): PlotlySpec {
  const value = YAML.parse(source) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Plotly input must be a JSON or YAML object.')
  }
  const spec = value as PlotlySpec
  if (!Array.isArray(spec.data)) throw new Error('Plotly input requires a data array.')
  const serialized = JSON.stringify(spec)
  if (/(?:https?:)?\/\//i.test(serialized)) throw new Error('Remote Plotly resources are blocked in preview.')
  return spec
}

function decodeSvgDataUrl(value: string): string {
  const comma = value.indexOf(',')
  if (!value.startsWith('data:image/svg+xml') || comma < 0) throw new Error('Plotly did not produce an SVG result.')
  const metadata = value.slice(0, comma)
  const payload = value.slice(comma + 1)
  return metadata.includes(';base64') ? window.atob(payload) : decodeURIComponent(payload)
}

export async function renderPlotly(block: DiagramBlock, context: DiagramRenderContext): Promise<DiagramRenderResult> {
  throwIfAborted(context.signal)
  const Plotly = (await import('plotly.js-dist-min')).default
  const spec = parsePlotlySpec(block.source)
  const root = document.createElement('div')
  root.style.width = '760px'
  root.style.height = '440px'
  root.style.position = 'fixed'
  root.style.left = '-10000px'
  document.body.appendChild(root)
  try {
    await Plotly.newPlot(root, spec.data ?? [], {
      autosize: false,
      width: 760,
      height: 440,
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: context.theme === 'dark' ? '#e5e7eb' : '#20242a' },
      ...spec.layout,
    }, { responsive: false, displayModeBar: false, staticPlot: false, ...spec.config })
    throwIfAborted(context.signal)
    const dataUrl = await Plotly.toImage(root, { format: 'svg', width: 760, height: 440 })
    throwIfAborted(context.signal)
    return svgResult(decodeSvgDataUrl(dataUrl))
  } finally {
    Plotly.purge(root)
    root.remove()
  }
}
