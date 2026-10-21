/**
 * User-facing instruments the admin bench can open, withdraw, and meter.
 * `tool_id` is the quota key stored on usages. Home cards whose id
 * differs from that key are listed in HOME_TOOL_ID.
 *
 * The bench seeds tools from this list. Existing rows are left alone.
 */

export type ToolCatalogEntry = {
  tool_id: string
  label: string
  href: string
  group: string
  guest_limit: number
  member_limit: number
}

export const TOOL_CATALOG: readonly ToolCatalogEntry[] = [
  { tool_id: 'image-to-pdf', label: 'Images to PDF', href: '/image-to-pdf', group: 'Convert', guest_limit: 5, member_limit: 10 },
  { tool_id: 'pdf-to-images', label: 'PDF to Images', href: '/pdf-to-images', group: 'Convert', guest_limit: 5, member_limit: 10 },
  { tool_id: 'pdf-to-word', label: 'PDF to Word', href: '/pdf-to-word', group: 'Convert', guest_limit: 5, member_limit: 10 },
  { tool_id: 'word-to-pdf', label: 'Word to PDF', href: '/word-to-pdf', group: 'Convert', guest_limit: 5, member_limit: 10 },
  { tool_id: 'pdf-to-markdown', label: 'Mr. Markdown', href: '/mr-markdown', group: 'Convert', guest_limit: 5, member_limit: 10 },
  { tool_id: 'markdown-to-pdf', label: 'Markdown to PDF', href: '/markdown-to-pdf', group: 'Convert', guest_limit: 5, member_limit: 10 },
  { tool_id: 'merge-pdf', label: 'Merge PDF', href: '/merge-pdf', group: 'Convert', guest_limit: 5, member_limit: 10 },
  { tool_id: 'split-pdf', label: 'Split PDF', href: '/split-pdf', group: 'Convert', guest_limit: 5, member_limit: 10 },
  { tool_id: 'rotate-pdf', label: 'Rotate PDF', href: '/rotate-pdf', group: 'Convert', guest_limit: 5, member_limit: 10 },
  { tool_id: 'compress-pdf', label: 'Compress PDF', href: '/compress-pdf', group: 'Convert', guest_limit: 5, member_limit: 10 },
  { tool_id: 'image-to-text', label: 'Image to Text', href: '/image-to-text', group: 'Extract', guest_limit: 5, member_limit: 10 },
  { tool_id: 'bijoy-converter', label: 'Bijoy to Unicode', href: '/bijoy-converter', group: 'Extract', guest_limit: 5, member_limit: 10 },
  { tool_id: 'ai-analyzer', label: 'AI Analyzer', href: '/ai-analyzer', group: 'AI', guest_limit: 5, member_limit: 10 },
  { tool_id: 'document-ai', label: 'Document AI', href: '/document-ai', group: 'AI', guest_limit: 5, member_limit: 10 },
  { tool_id: 'batch-process', label: 'Batch Process', href: '/batch-process', group: 'Advanced', guest_limit: 5, member_limit: 10 },
  { tool_id: 'fasta-tools', label: 'FASTA Tools', href: '/fasta-tools', group: 'Advanced', guest_limit: 5, member_limit: 10 },
  { tool_id: 'pdf-editor', label: 'PDF Editor', href: '/pdf-editor', group: 'Edit', guest_limit: 5, member_limit: 10 },
  { tool_id: 'image-editor', label: 'Image Editor', href: '/image-editor', group: 'Edit', guest_limit: 5, member_limit: 10 },
]

const HOME_TOOL_ID: Record<string, string> = {
  batch: 'batch-process',
  'fasta-tool': 'fasta-tools',
}

export function toolIdForHomeCard(homeId: string) {
  return HOME_TOOL_ID[homeId] ?? homeId
}

export function toolIdForHref(href: string) {
  return TOOL_CATALOG.find((tool) => tool.href === href)?.tool_id ?? null
}

/**
 * Calls left after an admin changes the cap.
 * Used 5 of 5, cap raised to 10 → 5 left.
 * Used 2 of 5, cap lowered to 2 → 0 left.
 */
export function callsRemaining(used: number, limit: number) {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || used < 0 || limit < 0) {
    throw new Error('used and limit must be non-negative finite numbers')
  }
  return Math.max(0, limit - used)
}

export function periodHours(period: 'day' | 'week') {
  return period === 'week' ? 168 : 24
}

/**
 * Calls left are the cap minus calls already in the window.
 * The reset instant is one period after the oldest counted call.
 */
export function usageWindow(
  used: number,
  limit: number,
  oldest: Date | null,
  hours: number,
  now: Date,
) {
  const anchor = oldest ?? now
  return {
    allowed: used < limit,
    remaining: callsRemaining(used, limit),
    resets_at: new Date(anchor.getTime() + hours * 3_600_000).toISOString(),
  }
}
