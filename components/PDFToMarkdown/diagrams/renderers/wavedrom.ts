import YAML from 'yaml'
import type { DiagramBlock, DiagramRenderContext, DiagramRenderResult } from '../types'
import { svgResult, throwIfAborted } from './shared'

type OnmlNode = [string, Record<string, unknown>, ...unknown[]]
type WaveDromModule = {
  renderAny: (index: number, source: Record<string, unknown>, skin: unknown, notFirstSignal: boolean) => OnmlNode
  waveSkin: unknown
  onml: { stringify: (tree: OnmlNode) => string }
}

function parseWaveDromSource(source: string): Record<string, unknown> {
  try {
    const value = YAML.parse(source) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('WaveDrom input must be an object.')
    return value as Record<string, unknown>
  } catch (error) {
    throw new Error(error instanceof Error ? `Invalid WaveDrom JSON/YAML: ${error.message}` : 'Invalid WaveDrom JSON/YAML.')
  }
}

export async function renderWaveDrom(block: DiagramBlock, context: DiagramRenderContext): Promise<DiagramRenderResult> {
  throwIfAborted(context.signal)
  const wavedrom = await import('wavedrom') as unknown as WaveDromModule
  const tree = wavedrom.renderAny(0, parseWaveDromSource(block.source), wavedrom.waveSkin, false)
  throwIfAborted(context.signal)
  return svgResult(wavedrom.onml.stringify(tree))
}