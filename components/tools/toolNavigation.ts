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
// Aliases carry the Bangla words people actually type ("জোড়া", "ভাগ"), so the
// switcher and Ctrl/⌘K find a tool by either language (roadmap §7.2).
const navigation: Record<ToolId, { group: NavigationGroup; format: string; aliases: string }> = {
  'image-to-pdf': { group: 'Convert Files', format: 'PDF', aliases: 'jpg jpeg png photos ছবি থেকে পিডিএফ' },
  'pdf-to-images': { group: 'Convert Files', format: 'IMG', aliases: 'jpg jpeg png raster পিডিএফ থেকে ছবি' },
  'pdf-to-word': { group: 'Convert Files', format: 'DOCX', aliases: 'docx editable word ওয়ার্ড' },
  'word-to-pdf': { group: 'Convert Files', format: 'PDF', aliases: 'doc docx word ওয়ার্ড থেকে পিডিএফ' },
  'pdf-to-markdown': { group: 'Convert Files', format: 'MD', aliases: 'md markdown studio মার্কডাউন' },
  'markdown-to-pdf': { group: 'Convert Files', format: 'PDF', aliases: 'md markdown মার্কডাউন থেকে পিডিএফ' },
  'merge-pdf': { group: 'PDF Operations', format: 'JOIN', aliases: 'combine join জোড়া একত্র যুক্ত' },
  'split-pdf': { group: 'PDF Operations', format: 'CUT', aliases: 'cut separate pages ভাগ আলাদা কাটা' },
  'rotate-pdf': { group: 'PDF Operations', format: 'TURN', aliases: 'turn orientation ঘোরানো ঘুরানো' },
  'compress-pdf': { group: 'PDF Operations', format: 'SIZE', aliases: 'reduce shrink size ছোট সংকোচন কমানো' },
  'image-to-text': { group: 'Read And Extract', format: 'TXT', aliases: 'ocr scan recognition লেখা ওসিআর স্ক্যান' },
  'bijoy-converter': { group: 'Read And Extract', format: 'UTF', aliases: 'bangla bengali unicode bijoy বিজয় বাংলা ইউনিকোড' },
  'ai-analyzer': { group: 'Analyze And Automate', format: 'AI', aliases: 'summary insights analyze বিশ্লেষণ সারাংশ' },
  'batch-process': { group: 'Analyze And Automate', format: 'BULK', aliases: 'bulk workflow automation একসাথে অনেক' },
  'fasta-tools': { group: 'Sequences', format: 'DNA', aliases: 'dna rna protein biology sequence ডিএনএ সিকোয়েন্স' },
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
  { id: 'pdf-editor', href: '/pdf-editor', label: 'PDF Editor', description: 'Edit and preview your PDF workspace.', group: 'Workspaces', format: 'EDIT', keywords: 'page editor সম্পাদনা এডিট' },
  { id: 'document-ai', href: '/document-ai', label: 'Document AI', description: 'Ask questions about your documents.', group: 'Workspaces', format: 'CHAT', keywords: 'chat questions rag প্রশ্ন চ্যাট' },
  { id: 'image-editor', href: '/image-editor', label: 'Image Editor', description: 'Resize, crop, and enhance your images.', group: 'Workspaces', format: 'PIXEL', keywords: 'photo canvas crop ছবি সম্পাদনা' },
]

/** The breadcrumb's middle step for a tool page, e.g. "PDF Operations". */
export function navigationGroupOf(id: NavigationId): NavigationGroup | null {
  return navigationEntries.find((entry) => entry.id === id)?.group ?? null
}

/**
 * Up to `limit` distinct tools the user recently produced something with,
 * newest first, excluding the current page. Built from the browser-local
 * recent-conversion log (lib/history), so it reflects real use, not guesses.
 */
export function recentNavigation(
  history: readonly { toolId: string; at: number }[],
  currentId: NavigationId,
  limit = 3,
): NavigationEntry[] {
  const seen = new Set<string>()
  const out: NavigationEntry[] = []
  for (const item of [...history].sort((a, b) => b.at - a.at)) {
    if (item.toolId === currentId || seen.has(item.toolId)) continue
    const entry = navigationEntries.find((candidate) => candidate.id === item.toolId)
    if (!entry) continue
    seen.add(item.toolId)
    out.push(entry)
    if (out.length === limit) break
  }
  return out
}

/**
 * Whether a keydown is the Ctrl/⌘K palette shortcut *and* nobody else owns it:
 * not already handled, not typed into a field (Mr. Markdown binds ⌘K to
 * "insert link" in its editor), and not while another modal is open.
 */
export function isPaletteShortcut(event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  defaultPrevented: boolean
  targetIsEditable: boolean
  modalOpen: boolean
}): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false
  if (event.key.toLowerCase() !== 'k') return false
  return !event.defaultPrevented && !event.targetIsEditable && !event.modalOpen
}

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
