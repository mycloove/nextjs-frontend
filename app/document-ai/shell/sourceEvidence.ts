import type { ShellCitation, ShellDocument, ShellMessage, ShellSource, SourcePage } from './types.ts'

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined

export const sourcePageNumber = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null

export function normalizeChatSources(payload: unknown): { sources: ShellSource[]; resolvedDocId?: string } {
  const data = record(payload)
  const resolvedDocId = text(data.resolved_doc_id)
  const sources = Array.isArray(data.sources) ? data.sources.filter((source) => !!source && typeof source === 'object' && !Array.isArray(source)).map((raw) => {
    const source = record(raw)
    const page = sourcePageNumber(source.page)
    return {
      label: page === null ? 'Page unknown' : `p.${page}`,
      page,
      text: text(source.preview) ?? text(source.text),
      doc_id: text(source.doc_id) ?? resolvedDocId,
      doc_number: sourcePageNumber(source.doc_number) ?? undefined,
    }
  }) : []
  return { sources, resolvedDocId }
}

/** Shared by chat chips, Insights and excerpt groups, including legacy messages. */
export function sourceCitation(message: ShellMessage, source: ShellSource, index: number): ShellCitation {
  const page = sourcePageNumber(source.page)
  return {
    id: `${message.id}_${index}`,
    page,
    label: page === null ? 'Page unknown' : `p.${page}`,
    text: text(source.text),
    docId: text(source.doc_id) ?? text(message.resolvedDocId),
    isGap: false,
  }
}

export function buildSourcePages(messages: ShellMessage[], documents: ShellDocument[]): SourcePage[] {
  const groups = new Map<string, SourcePage>()
  for (const message of messages) {
    if (message.role !== 'assistant' || message.loading || message.error) continue
    for (const [index, source] of (message.sources ?? []).entries()) {
      const citation = sourceCitation(message, source, index)
      // Unknown identity cannot establish that two references belong to one page.
      const id = citation.docId && citation.page !== null
        ? JSON.stringify([citation.docId, citation.page])
        : JSON.stringify(['unknown-reference', citation.id])
      const document = documents.find((item) => item.docId === citation.docId)
      const name = document?.name ?? (citation.docId ? `Document ${citation.docId}` : 'Document unknown')
      const pageLabel = `${name} / ${citation.page === null ? 'Page unknown' : `Page ${citation.page}`}`
      let group = groups.get(id)
      if (!group) {
        group = { id, docId: citation.docId, citationIds: [], pageNum: citation.page, pageLabel, blocks: [] }
        groups.set(id, group)
      }
      group.citationIds.push(citation.id)
      group.blocks.push({ type: 'paragraph', segments: citation.text
        ? [{ type: 'highlight', text: citation.text, citationId: citation.id, isGap: false }]
        : [{ type: 'text', text: 'No excerpt text was returned for this reference.' }],
      })
    }
  }
  return [...groups.values()]
}

export function sourceGroupForCitation(groups: SourcePage[], citation: ShellCitation): SourcePage | undefined {
  return groups.find((group) => group.citationIds.includes(citation.id))
    ?? (citation.docId && citation.page !== null ? groups.find((group) => group.docId === citation.docId && group.pageNum === citation.page) : undefined)
}
