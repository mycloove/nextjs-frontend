import type { DiagramBlock, DiagramRenderContext, DiagramRenderResult } from '../types'
import { svgResult, throwIfAborted } from './shared'

let mermaidRenderCount = 0
const MERMAID_THEMES = new Set(['base', 'dark', 'default', 'forest', 'neutral'])
const MERMAID_BRANCH_LABEL_RE = /^(?:yes|no)$/i

function polishBranchLabels(svg: string): string {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return svg

  const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (document.querySelector('parsererror')) return svg

  let changed = false
  document.querySelectorAll<SVGGElement>('.edgeLabel').forEach((label) => {
    const text = (label.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!MERMAID_BRANCH_LABEL_RE.test(text)) return

    label.classList.add('mr-mermaid-branch-label')
    const transform = label.getAttribute('transform')?.trim()
    label.setAttribute('transform', `${transform ? `${transform} ` : ''}translate(0 -9)`)
    changed = true
  })

  return changed ? new XMLSerializer().serializeToString(document.documentElement) : svg
}

export async function renderMermaid(block: DiagramBlock, context: DiagramRenderContext): Promise<DiagramRenderResult> {
  throwIfAborted(context.signal)
  const mermaid = (await import('mermaid')).default
  const requestedTheme = String(block.attributes.theme ?? '').toLowerCase()
  const theme = MERMAID_THEMES.has(requestedTheme)
    ? requestedTheme as 'base' | 'dark' | 'default' | 'forest' | 'neutral'
    : context.theme === 'dark' ? 'dark' : 'default'
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme,
    htmlLabels: false,
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    flowchart: { htmlLabels: false, useMaxWidth: false },
    class: { htmlLabels: false, useMaxWidth: false },
    sequence: { useMaxWidth: false },
    state: { useMaxWidth: false },
    er: { useMaxWidth: false },
    gantt: { useMaxWidth: false },
    suppressErrorRendering: true,
  })
  const rendered = await mermaid.render(`mr-diagram-${mermaidRenderCount++}`, block.source)
  throwIfAborted(context.signal)
  return svgResult(polishBranchLabels(rendered.svg))
}
