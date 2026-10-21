import type { Metadata } from 'next'

export type ToolId =
  | 'image-to-pdf'
  | 'pdf-to-images'
  | 'pdf-to-word'
  | 'word-to-pdf'
  | 'image-to-text'
  | 'pdf-to-markdown'
  | 'markdown-to-pdf'
  | 'ai-analyzer'
  | 'batch-process'
  | 'fasta-tools'
  | 'bijoy-converter'
  | 'merge-pdf'
  | 'split-pdf'
  | 'rotate-pdf'
  | 'compress-pdf'

export type ToolDefinition = {
  id: ToolId
  href: `/${string}`
  label: string
  description: string
  group: 'Convert' | 'Extract' | 'AI' | 'Advanced'
  apiEndpoint: string
  icon: string
  badge?: string
}

export const tools: readonly ToolDefinition[] = [
  { id: 'image-to-pdf', href: '/image-to-pdf', label: 'Images to PDF', description: 'Combine images into one PDF document.', group: 'Convert', apiEndpoint: '/api/images-to-pdf', icon: '🖼️' },
  { id: 'pdf-to-images', href: '/pdf-to-images', label: 'PDF to Images', description: 'Export PDF pages as high-quality images.', group: 'Convert', apiEndpoint: '/api/pdf-to-images', icon: '📄' },
  { id: 'pdf-to-word', href: '/pdf-to-word', label: 'PDF to Word', description: 'Convert PDF files into editable Word documents.', group: 'Convert', apiEndpoint: '/api/pdf-to-word', icon: '📝' },
  { id: 'word-to-pdf', href: '/word-to-pdf', label: 'Word to PDF', description: 'Create polished PDFs from Word documents.', group: 'Convert', apiEndpoint: '/api/word-to-pdf', icon: '📃' },
  { id: 'image-to-text', href: '/image-to-text', label: 'Image to Text', description: 'Extract text from images with OCR.', group: 'Extract', apiEndpoint: '/api/image-to-text', icon: '🔎' },
  { id: 'pdf-to-markdown', href: '/mr-markdown', label: 'Mr. Markdown', description: 'Turn PDFs into clean, editable Markdown.', group: 'Convert', apiEndpoint: '/api/pdf-to-markdown', icon: '✍️' },
  { id: 'markdown-to-pdf', href: '/markdown-to-pdf', label: 'Markdown to PDF', description: 'Render Markdown into a shareable PDF.', group: 'Convert', apiEndpoint: '/api/markdown-to-pdf', icon: '📑' },
  { id: 'ai-analyzer', href: '/ai-analyzer', label: 'AI Analyzer', description: 'Generate useful insights from a document.', group: 'AI', apiEndpoint: '/api/analyze-pdf', icon: '✨', badge: 'AI powered' },
  { id: 'batch-process', href: '/batch-process', label: 'Batch Process', description: 'Process multiple files in one workflow.', group: 'Advanced', apiEndpoint: '/api/batch-process', icon: '⚡', badge: 'Bulk mode' },
  { id: 'fasta-tools', href: '/fasta-tools', label: 'FASTA Tools', description: 'Analyze, transform, and export FASTA sequences.', group: 'Advanced', apiEndpoint: '/api/seq-tools', icon: '🧬' },
  { id: 'bijoy-converter', href: '/bijoy-converter', label: 'Bijoy to Unicode', description: 'Convert legacy Bijoy-encoded Bangla text to clean Unicode.', group: 'Extract', apiEndpoint: '/api/bijoy-convert', icon: '🔤', badge: 'Bangla' },
  { id: 'merge-pdf', href: '/merge-pdf', label: 'Merge PDF', description: 'Combine multiple PDFs into one document, in your order.', group: 'Convert', apiEndpoint: '/api/merge-pdf', icon: '🔗' },
  { id: 'split-pdf', href: '/split-pdf', label: 'Split PDF', description: 'Cut one PDF into parts by page ranges.', group: 'Convert', apiEndpoint: '/api/split-pdf', icon: '✂️' },
  { id: 'rotate-pdf', href: '/rotate-pdf', label: 'Rotate PDF', description: 'Turn pages by a quarter-turn, all or a range.', group: 'Convert', apiEndpoint: '/api/rotate-pdf', icon: '🔄' },
  { id: 'compress-pdf', href: '/compress-pdf', label: 'Compress PDF', description: 'Shrink a PDF structurally — no image re-encoding.', group: 'Convert', apiEndpoint: '/api/compress-pdf', icon: '🗜️' },
] as const

export const toolGroups = ['Convert', 'Extract', 'AI', 'Advanced'] as const

export function getTool(id: ToolId): ToolDefinition {
  const tool = tools.find((item) => item.id === id)
  if (!tool) throw new Error(`Unknown tool: ${id}`)
  return tool
}

export function toolMetadata(id: ToolId): Metadata {
  const tool = getTool(id)
  return {
    title: `${tool.label} | mycloove`,
    description: tool.description,
  }
}
