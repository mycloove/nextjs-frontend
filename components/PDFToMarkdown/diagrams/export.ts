import { renderMarkdownToHtml } from '../utils'
import { parseDiagramFences } from './fence-parser'
import { getDiagramCapability } from './registry'
import type { DiagramBlock, DiagramRenderContext, DiagramRenderResult } from './types'

export type DiagramExportAsset = {
  filename: string
  dataUrl: string
  mimeType: string
  alt: string
}

export type DiagramExportDocument = {
  html: string
  markdown: string
  assets: DiagramExportAsset[]
  warnings: string[]
  expectedDiagramCount: number
  renderedDiagramCount: number
}

const XML_DECLARATION_RE = /^\s*<\?xml[^>]*>\s*/i
const MAX_RASTER_DIMENSION = 2400
const MAX_RASTER_AREA = 8_000_000

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character)
}

function safeFilename(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || fallback
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(XML_DECLARATION_RE, ''))}`
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The rendered diagram could not be decoded.'))
    image.src = source
  })
}

async function rasterizeSvg(svg: string, result: DiagramRenderResult): Promise<string> {
  const image = await loadImage(svgDataUrl(svg))
  const sourceWidth = Math.max(1, result.width || image.naturalWidth || image.width || 1200)
  const sourceHeight = Math.max(1, result.height || image.naturalHeight || image.height || 675)
  const dimensionScale = Math.min(2, MAX_RASTER_DIMENSION / Math.max(sourceWidth, sourceHeight))
  const areaScale = Math.sqrt(MAX_RASTER_AREA / (sourceWidth * sourceHeight))
  const scale = Math.max(0.1, Math.min(dimensionScale, areaScale))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas export is unavailable in this browser.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL('image/png')
}

async function resultToAsset(result: DiagramRenderResult, block: DiagramBlock, index: number): Promise<DiagramExportAsset> {
  const requested = typeof block.attributes.filename === 'string' ? block.attributes.filename : ''
  const fallbackBase = `diagram-${index + 1}-${block.engine}`
  if (result.kind === 'image') {
    const mimeType = result.mimeType || 'image/png'
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1] || 'png'
    return {
      filename: safeFilename(requested || `${fallbackBase}.${extension}`, `${fallbackBase}.${extension}`),
      dataUrl: result.content,
      mimeType,
      alt: `${getDiagramCapability(block.engine).label} diagram`,
    }
  }

  const svg = result.kind === 'html'
    ? new DOMParser().parseFromString(`<div>${result.content}</div>`, 'text/html').querySelector('svg')?.outerHTML
    : result.content
  if (!svg) throw new Error(`${getDiagramCapability(block.engine).label} did not produce an exportable SVG.`)
  const requestedBase = requested.replace(/\.[A-Za-z0-9]+$/, '')
  return {
    filename: safeFilename(`${requestedBase || fallbackBase}.png`, `${fallbackBase}.png`),
    dataUrl: await rasterizeSvg(svg, result),
    mimeType: 'image/png',
    alt: `${getDiagramCapability(block.engine).label} diagram`,
  }
}

async function renderForExport(block: DiagramBlock, theme: 'light' | 'dark'): Promise<DiagramRenderResult> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  const context: DiagramRenderContext = { theme, signal: controller.signal }
  try {
    const { renderDiagram } = await import('./renderers')
    return await renderDiagram(block, context)
  } finally {
    window.clearTimeout(timeout)
  }
}

function codeFallback(block: DiagramBlock, message: string): string {
  const label = getDiagramCapability(block.engine).label
  return `<figure class="mr-export-diagram mr-export-diagram-fallback"><figcaption>${escapeHtml(label)}: ${escapeHtml(message)}</figcaption><pre><code>${escapeHtml(block.source)}</code></pre></figure>`
}

export async function renderMarkdownForExport(
  markdown: string,
  theme: 'light' | 'dark' = 'light',
): Promise<DiagramExportDocument> {
  const blocks = parseDiagramFences(markdown)
  const expectedDiagramCount = blocks.filter((block) => block.attributes.code_block !== true).length
  if (!blocks.length) {
    return {
      html: renderMarkdownToHtml(markdown),
      markdown,
      assets: [],
      warnings: [],
      expectedDiagramCount: 0,
      renderedDiagramCount: 0,
    }
  }

  const htmlParts: string[] = []
  const markdownParts: string[] = []
  const assets: DiagramExportAsset[] = []
  const warnings: string[] = []
  let cursor = 0

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    const plain = markdown.slice(cursor, block.start)
    if (plain) {
      htmlParts.push(renderMarkdownToHtml(plain))
      markdownParts.push(plain)
    }

    if (block.attributes.code_block === true) {
      const sourceFence = markdown.slice(block.start, block.end)
      htmlParts.push(renderMarkdownToHtml(sourceFence))
      markdownParts.push(sourceFence)
      cursor = block.end
      continue
    }

    try {
      const asset = await resultToAsset(await renderForExport(block, theme), block, index)
      assets.push(asset)
      const align = ['left', 'center', 'right'].includes(String(block.attributes.align)) ? String(block.attributes.align) : 'center'
      htmlParts.push(`<figure class="mr-export-diagram" style="text-align:${align}"><img data-mr-diagram="true" src="${asset.dataUrl}" alt="${escapeHtml(asset.alt)}"></figure>`)
      markdownParts.push(`\n![${asset.alt}](images/${asset.filename})\n`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Rendering failed.'
      warnings.push(`${getDiagramCapability(block.engine).label}: ${message}`)
      htmlParts.push(codeFallback(block, message))
      markdownParts.push(markdown.slice(block.start, block.end))
    }
    cursor = block.end
  }

  const remainder = markdown.slice(cursor)
  if (remainder) {
    htmlParts.push(renderMarkdownToHtml(remainder))
    markdownParts.push(remainder)
  }
  return {
    html: htmlParts.join(''),
    markdown: markdownParts.join(''),
    assets,
    warnings,
    expectedDiagramCount,
    renderedDiagramCount: assets.length,
  }
}

export function diagramExportStyles(): string {
  return '.mr-export-diagram{display:block;width:100%;max-width:100%;margin:14pt 0 16pt;padding:0;text-align:center;overflow:hidden;break-inside:avoid;page-break-inside:avoid}.mr-export-diagram img[data-mr-diagram="true"]{display:block;width:auto;height:auto;max-width:100%;max-height:237mm;margin:0 auto;object-fit:contain}.mr-export-diagram-fallback{padding:12px;border:1px solid #d0d7de}.mr-export-diagram-fallback figcaption{margin-bottom:8px;color:#8a4b08;font-size:12px}'
}