import YAML from 'yaml'
import type { EventListenerHandler } from 'vega'
import type { DiagramBlock, DiagramRenderContext, DiagramRenderResult } from '../types'
import { svgResult, throwIfAborted } from './shared'

const REMOTE_RESOURCE_KEYS = new Set(['url', 'href'])
const DARK_AXIS_LABEL_COLOR = '#e2e8f0'
const DARK_AXIS_TITLE_COLOR = '#f8fafc'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function setDefault(target: UnknownRecord, key: string, value: string): void {
  if (!(key in target)) target[key] = value
}

function parseSpec(source: string): Record<string, unknown> {
  const parsed = YAML.parse(source) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Vega input must be a JSON or YAML object.')
  const spec = parsed as Record<string, unknown>
  const schema = typeof spec.$schema === 'string' ? spec.$schema : ''
  if (/\/vega\/v5\.json$/i.test(schema)) spec.$schema = schema.replace('/v5.json', '/v6.json')
  if (/\/vega-lite\/v5\.json$/i.test(schema)) spec.$schema = schema.replace('/v5.json', '/v6.json')
  return spec
}

function assertNoRemoteResources(value: unknown, parentKey = ''): void {
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoRemoteResources(item, parentKey))
    return
  }
  if (!value || typeof value !== 'object') return
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    if (REMOTE_RESOURCE_KEYS.has(key.toLowerCase()) && typeof child === 'string' && /^(?:https?:)?\/\//i.test(child)) {
      throw new Error(`Remote Vega resource '${key}' is blocked in preview.`)
    }
    assertNoRemoteResources(child, key)
  })
  void parentKey
}

function applyDarkNativeVegaAxes(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(applyDarkNativeVegaAxes)
    return
  }
  if (!isRecord(value)) return

  if (Array.isArray(value.axes)) {
    value.axes.forEach((axis) => {
      if (!isRecord(axis)) return
      setDefault(axis, 'labelColor', DARK_AXIS_LABEL_COLOR)
      setDefault(axis, 'titleColor', DARK_AXIS_TITLE_COLOR)
    })
  }

  Object.values(value).forEach(applyDarkNativeVegaAxes)
}

function applyVegaThemeDefaults(spec: UnknownRecord, engine: DiagramBlock['engine'], theme: DiagramRenderContext['theme']): void {
  if (theme !== 'dark') return

  if (engine === 'vega-lite') {
    const config = isRecord(spec.config) ? spec.config : {}
    const axis = isRecord(config.axis) ? config.axis : {}
    setDefault(axis, 'labelColor', DARK_AXIS_LABEL_COLOR)
    setDefault(axis, 'titleColor', DARK_AXIS_TITLE_COLOR)
    config.axis = axis
    spec.config = config
    return
  }

  applyDarkNativeVegaAxes(spec)
}

export async function renderVega(block: DiagramBlock, context: DiagramRenderContext): Promise<DiagramRenderResult> {
  throwIfAborted(context.signal)
  const spec = parseSpec(block.source)
  assertNoRemoteResources(spec)
  applyVegaThemeDefaults(spec, block.engine, context.theme)
  const embed = (await import('vega-embed')).default
  const host = document.createElement('div')
  const result = await embed(host, spec, {
    mode: block.engine === 'vega-lite' ? 'vega-lite' : 'vega',
    renderer: 'svg',
    actions: false,
    tooltip: false,
    hover: false,
  })
  try {
    throwIfAborted(context.signal)
    return svgResult(await result.view.toSVG())
  } finally {
    result.finalize()
  }
}

export async function renderInteractiveVega(
  block: DiagramBlock,
  context: DiagramRenderContext,
  host: HTMLElement,
): Promise<() => void> {
  throwIfAborted(context.signal)
  const spec = parseSpec(block.source)
  assertNoRemoteResources(spec)
  applyVegaThemeDefaults(spec, block.engine, context.theme)
  const embed = (await import('vega-embed')).default
  const result = await embed(host, spec, {
    mode: block.engine === 'vega-lite' ? 'vega-lite' : 'vega',
    renderer: 'svg',
    actions: false,
    tooltip: false,
    hover: true,
  })

  try {
    throwIfAborted(context.signal)
    const { Handler } = await import('vega-tooltip')
    const tooltip = new Handler({
      theme: context.theme === 'dark' ? 'dark' : 'light',
      anchor: 'mark',
      position: ['top', 'bottom', 'right', 'left'],
    })
    const showTooltip: EventListenerHandler = (event, item) => {
      if (!item || item.mark?.role !== 'mark' || !item.datum || typeof item.datum !== 'object') return
      tooltip.call(result.view, event as MouseEvent, item, item.datum)
    }
    const hideTooltip: EventListenerHandler = (event, item) => {
      if (!item || item.mark?.role !== 'mark') return
      tooltip.call(result.view, event as MouseEvent, item, null)
    }
    result.view.addEventListener('mouseover', showTooltip)
    result.view.addEventListener('mouseout', hideTooltip)
    return () => {
      result.view.removeEventListener('mouseover', showTooltip)
      result.view.removeEventListener('mouseout', hideTooltip)
      tooltip.call(result.view, new MouseEvent('mouseout'), null as never, null)
      result.finalize()
    }
  } catch (error) {
    result.finalize()
    throw error
  }
}