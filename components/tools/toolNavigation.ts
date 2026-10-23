import { tools, type ToolId } from '../../lib/tools/registry.ts'

export const navigationGroups = ['Convert Files', 'PDF Operations', 'Read And Extract', 'Analyze And Automate', 'Sequences', 'Workspaces'] as const
type NavigationGroup = typeof navigationGroups[number]
export type NavigationId = ToolId | 'pdf-editor' | 'document-ai' | 'image-editor'
export type NavigationAvailability = { status: 'loading' | 'ready' | 'error'; enabled: (id: string) => boolean }
export type NavigationEntry = {
  id: NavigationId
  href: `/${string}`
  label: string
  description: string
  group: NavigationGroup
  format: string
  keywords: string
}

// Navigation grouping is a projection, not a change to the registry's metadata/API groups.
const navigation: Record<ToolId, { group: NavigationGroup; format: string; aliases: string }> = {
  'image-to-pdf': { group: 'Convert Files', format: 'PDF', aliases: 'jpg jpeg png photos' },
  'pdf-to-images': { group: 'Convert Files', format: 'IMG', aliases: 'jpg jpeg png raster' },
  'pdf-to-word': { group: 'Convert Files', format: 'DOCX', aliases: 'docx editable word' },
  'word-to-pdf': { group: 'Convert Files', format: 'PDF', aliases: 'doc docx word' },
  'pdf-to-markdown': { group: 'Convert Files', format: 'MD', aliases: 'md markdown studio' },
  'markdown-to-pdf': { group: 'Convert Files', format: 'PDF', aliases: 'md markdown' },
  'merge-pdf': { group: 'PDF Operations', format: 'JOIN', aliases: 'combine join' },
  'split-pdf': { group: 'PDF Operations', format: 'CUT', aliases: 'cut separate pages' },
  'rotate-pdf': { group: 'PDF Operations', format: 'TURN', aliases: 'turn orientation' },
  'compress-pdf': { group: 'PDF Operations', format: 'SIZE', aliases: 'reduce shrink size' },
  'image-to-text': { group: 'Read And Extract', format: 'TXT', aliases: 'ocr scan recognition' },
  'bijoy-converter': { group: 'Read And Extract', format: 'UTF', aliases: 'bangla bengali unicode bijoy' },
  'ai-analyzer': { group: 'Analyze And Automate', format: 'AI', aliases: 'summary insights analyze' },
  'batch-process': { group: 'Analyze And Automate', format: 'BULK', aliases: 'bulk workflow automation' },
  'fasta-tools': { group: 'Sequences', format: 'DNA', aliases: 'dna rna protein biology sequence' },
}

export const navigationEntries: readonly NavigationEntry[] = [
  ...tools.map((tool) => ({
    id: tool.id,
    href: tool.href,
    label: tool.label,
    description: tool.description,
    group: navigation[tool.id].group,
    format: navigation[tool.id].format,
    keywords: navigation[tool.id].aliases,
  })),
  { id: 'pdf-editor', href: '/pdf-editor', label: 'PDF Editor', description: 'Edit and preview your PDF workspace.', group: 'Workspaces', format: 'EDIT', keywords: 'page editor' },
  { id: 'document-ai', href: '/document-ai', label: 'Document AI', description: 'Ask questions about your documents.', group: 'Workspaces', format: 'CHAT', keywords: 'chat questions rag' },
  { id: 'image-editor', href: '/image-editor', label: 'Image Editor', description: 'Resize, crop, and enhance your images.', group: 'Workspaces', format: 'PIXEL', keywords: 'photo canvas crop' },
]

export function filterNavigation(query: string) {
  const terms = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  return navigationGroups.map((group) => ({
    group,
    entries: navigationEntries.filter((entry) => {
      const text = `${entry.label} ${entry.description} ${entry.keywords} ${entry.format} ${entry.id.replaceAll('-', ' ')}`.normalize('NFKC').toLocaleLowerCase()
      return entry.group === group && terms.every((term) => text.includes(term))
    }),
  })).filter((group) => group.entries.length > 0)
}

export function isNavigationUnavailable(entry: NavigationEntry, availability: NavigationAvailability) {
  return availability.status === 'ready' && !availability.enabled(entry.id)
}
