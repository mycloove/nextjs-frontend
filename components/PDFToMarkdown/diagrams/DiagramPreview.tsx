'use client'

import { Fragment, useMemo } from 'react'
import { renderMarkdownToHtml } from '../utils'
import { resolveFigureSources, type FigureMap } from '../figures'
import { parseDiagramFences } from './fence-parser'
import { DiagramBlock } from './DiagramBlock'

type DiagramPreviewProps = {
  markdown: string
  theme: 'light' | 'dark'
  /** Extracted PDF figures, so `assets/…` images render from their bytes. */
  figures?: FigureMap
}

type PreviewPart =
  | { kind: 'markdown'; key: string; source: string }
  | { kind: 'diagram'; key: string; block: ReturnType<typeof parseDiagramFences>[number] }

function buildPreviewParts(markdown: string): PreviewPart[] {
  const diagrams = parseDiagramFences(markdown)
  if (!diagrams.length) return [{ kind: 'markdown', key: 'markdown-0', source: markdown }]

  const parts: PreviewPart[] = []
  let cursor = 0

  diagrams.forEach((block, index) => {
    if (block.start > cursor) {
      parts.push({ kind: 'markdown', key: `markdown-${index}`, source: markdown.slice(cursor, block.start) })
    }
    parts.push({ kind: 'diagram', key: block.id, block })
    cursor = block.end
  })

  if (cursor < markdown.length) {
    parts.push({ kind: 'markdown', key: `markdown-${diagrams.length}`, source: markdown.slice(cursor) })
  }

  return parts
}

export function DiagramPreview({ markdown, theme, figures }: DiagramPreviewProps) {
  const parts = useMemo(() => buildPreviewParts(markdown), [markdown])
  const render = (source: string) => resolveFigureSources(renderMarkdownToHtml(source), figures)

  if (parts.length === 1 && parts[0].kind === 'markdown') {
    return <div className="mr-diagram-preview" dangerouslySetInnerHTML={{ __html: render(markdown) }} />
  }

  return (
    <div className="mr-diagram-preview">
      {parts.map((part) => (
        <Fragment key={part.key}>
          {part.kind === 'diagram' ? (
            <DiagramBlock block={part.block} theme={theme} />
          ) : part.source.trim() ? (
            <div dangerouslySetInnerHTML={{ __html: render(part.source) }} />
          ) : null}
        </Fragment>
      ))}
    </div>
  )
}