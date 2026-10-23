'use client'

import HomeFooter from '@/components/HomeFooter'
import QuantumCube from '@/components/quantum-cube/QuantumCube'
import LayeredIcon, { type LayeredIconVariant } from '@/components/tools/layered-icons/LayeredIcon'
import Topbar2 from '@/components/Topbar2'
import { toolIdForHomeCard } from '@/lib/usage/catalog'
import { useToolAvailability } from '@/lib/usage/useToolAvailability'
import { SITE_URL } from '@/lib/metadata'
import Link from 'next/link'
import { ChangeEvent, DragEvent as ReactDragEvent, useEffect, useMemo, useRef, useState } from 'react'

import './home.css'
import './theme.css'

type ToolGroup = 'Convert' | 'Extract' | 'Ask AI' | 'Advanced' | 'Edit'
type Filter = 'All' | ToolGroup | 'Favorites'

type Tool = {
  id: string
  label: string
  description: string
  group: ToolGroup
  badge: string
  format: string
  cta: string
  keywords: string
  featured?: 'Editable document' | 'AI powered'
  route: string
  icon: 'images' | 'camera' | 'word' | 'document' | 'markdown' | 'clipboard' | 'search' | 'sparkle' | 'batch' | 'dna' | 'merge' | 'split' | 'rotate' | 'compress'
  accent: 'coral' | 'emerald' | 'indigo'
}

const tools: Tool[] = [
  { id: 'image-to-pdf', label: 'Images to PDF', description: 'Combine multiple images into one clean, shareable PDF.', group: 'Convert', badge: 'Fast', format: 'JPG + PNG to PDF', cta: 'Combine images', keywords: 'photo picture merge combine jpg jpeg png', route: '/image-to-pdf', icon: 'images', accent: 'coral' },
  { id: 'pdf-to-images', label: 'PDF to Images', description: 'Export every PDF page as a crisp, high-quality image.', group: 'Convert', badge: 'High quality', format: 'PDF to PNG', cta: 'Export pages', keywords: 'photo picture export png jpg pages', route: '/pdf-to-images', icon: 'camera', accent: 'coral' },
  { id: 'pdf-to-word', label: 'PDF to Word', description: 'Turn a PDF into an editable DOCX, then review its text and layout.', group: 'Convert', badge: 'Editable', format: 'PDF to DOCX', cta: 'Make it editable', keywords: 'word doc docx edit document', featured: 'Editable document', route: '/pdf-to-word', icon: 'word', accent: 'coral' },
  { id: 'word-to-pdf', label: 'Word to PDF', description: 'Create a shareable PDF from a Word document.', group: 'Convert', badge: 'DOCX input', format: 'DOCX to PDF', cta: 'Create PDF', keywords: 'word doc docx publish office', route: '/word-to-pdf', icon: 'document', accent: 'coral' },
  { id: 'pdf-to-markdown', label: 'Mr. Markdown', description: 'Convert PDFs to Markdown, then edit and export in one workspace.', group: 'Convert', badge: 'Bangla', format: 'PDF to MD', cta: 'Extract Markdown', keywords: 'pdf to markdown mr markdown md text developer bangla', route: '/mr-markdown', icon: 'markdown', accent: 'coral' },
  { id: 'markdown-to-pdf', label: 'Markdown to PDF', description: 'Publish readable PDFs with native Bangla font support.', group: 'Convert', badge: 'Bangla', format: 'MD to PDF', cta: 'Publish PDF', keywords: 'markdown md print publish bangla', route: '/markdown-to-pdf', icon: 'clipboard', accent: 'coral' },
  { id: 'image-to-text', label: 'Image to Text', description: 'Extract reusable text from photos, screenshots, and scans.', group: 'Extract', badge: 'OCR', format: 'Image to text', cta: 'Extract text', keywords: 'ocr scan photo screenshot copy text', route: '/image-to-text', icon: 'search', accent: 'emerald' },
  { id: 'ai-analyzer', label: 'AI Analyzer', description: 'Generate a document summary and analysis, then check the source.', group: 'Ask AI', badge: 'Document analysis', format: 'PDF + AI', cta: 'Analyze a document', keywords: 'summary insights document ai analysis', featured: 'AI powered', route: '/ai-analyzer', icon: 'sparkle', accent: 'indigo' },
  { id: 'batch', label: 'Batch Process', description: 'Run one repeatable workflow across multiple files at once.', group: 'Advanced', badge: 'Batch', format: 'Multi-file', cta: 'Build a batch', keywords: 'bulk multiple automation workflow files', route: '/batch-process', icon: 'batch', accent: 'indigo' },
  { id: 'fasta-tool', label: 'FASTA Tools', description: 'Inspect and work with biological sequences in one workspace.', group: 'Advanced', badge: 'Developer', format: 'FASTA + sequence', cta: 'Inspect sequence', keywords: 'dna biology bioinformatics sequence fasta fa', route: '/fasta-tools', icon: 'dna', accent: 'indigo' },
  { id: 'bijoy-converter', label: 'Bijoy to Unicode', description: 'Convert legacy Bijoy-encoded Bangla text into clean, searchable Unicode.', group: 'Extract', badge: 'Bangla', format: 'Bijoy to Unicode', cta: 'Convert Bijoy text', keywords: 'bijoy unicode bangla bengali legacy convert text', route: '/bijoy-converter', icon: 'search', accent: 'emerald' },
  { id: 'merge-pdf', label: 'Merge PDF', description: 'Combine multiple PDFs into one clean document.', group: 'Convert', badge: 'Multi-file', format: 'PDF + PDF', cta: 'Combine PDFs', keywords: 'merge combine join append stack documents one', route: '/merge-pdf', icon: 'merge', accent: 'coral' },
  { id: 'split-pdf', label: 'Split PDF', description: 'Cut one PDF into parts by page ranges.', group: 'Convert', badge: 'Precise', format: 'PDF to PDFs', cta: 'Split pages', keywords: 'split cut divide extract pages range separate', route: '/split-pdf', icon: 'split', accent: 'coral' },
  { id: 'rotate-pdf', label: 'Rotate PDF', description: 'Turn every page — or just a range — by 90°, 180° or 270°.', group: 'Convert', badge: 'Quarter-turn', format: 'PDF in, PDF out', cta: 'Rotate pages', keywords: 'rotate turn sideways upside down landscape portrait angle', route: '/rotate-pdf', icon: 'rotate', accent: 'coral' },
  { id: 'compress-pdf', label: 'Compress PDF', description: 'Shrink PDF file size structurally, text stays selectable.', group: 'Convert', badge: 'Smaller files', format: 'PDF to smaller PDF', cta: 'Compress PDF', keywords: 'compress shrink reduce size optimize smaller compact', route: '/compress-pdf', icon: 'compress', accent: 'coral' },
  { id: 'document-ai', label: 'Document AI', description: 'Ask a document questions and keep the answers beside the pages.', group: 'Ask AI', badge: 'Chat', format: 'PDF + chat', cta: 'Open the reading room', keywords: 'chat rag document ai ask questions', route: '/document-ai', icon: 'sparkle', accent: 'indigo' },
  { id: 'pdf-editor', label: 'PDF Editor', description: 'Change the text that is actually in the file, then export those bytes.', group: 'Edit', badge: 'Structural', format: 'PDF in, PDF out', cta: 'Edit the PDF', keywords: 'edit text redact wysiwyg pages', route: '/pdf-editor', icon: 'document', accent: 'indigo' },
  { id: 'image-editor', label: 'Image Editor', description: 'Crop, resize, and compress an image on the canvas before you export it.', group: 'Edit', badge: 'Canvas', format: 'Image to image', cta: 'Open the darkroom', keywords: 'crop resize compress enhance photo', route: '/image-editor', icon: 'images', accent: 'emerald' },
]

/* Structured data for the marketing home. The home route is a client component,
   so it cannot export `metadata`; JSON-LD is the SEO signal it *can* carry. */
const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#org`,
      name: 'mycloove',
      url: SITE_URL,
      logo: `${SITE_URL}/quantum-core-octopus.png`,
      description: 'Calm, focused tools for PDF, Word, image, Markdown, and FASTA files.',
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'mycloove',
      publisher: { '@id': `${SITE_URL}/#org` },
    },
    {
      '@type': 'SoftwareApplication',
      name: 'mycloove',
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Web',
      url: SITE_URL,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      featureList: tools.map((tool) => tool.label),
    },
  ],
}

const layeredIconVariants: Record<string, LayeredIconVariant> = {
  'pdf-to-word': 'pdf-to-word',
  'pdf-to-markdown': 'pdf-to-markdown',
  'image-to-pdf': 'image-to-pdf',
  'ai-analyzer': 'ai-analyzer',
  'pdf-to-images': 'pdf-to-images',
  'word-to-pdf': 'word-to-pdf',
  'markdown-to-pdf': 'markdown-to-pdf',
  'image-to-text': 'image-to-text',
  batch: 'batch',
  'fasta-tool': 'fasta-tool',
  'bijoy-converter': 'bijoy-converter',
  'merge-pdf': 'merge-pdf',
  'split-pdf': 'split-pdf',
  'rotate-pdf': 'rotate-pdf',
  'compress-pdf': 'compress-pdf',
  'pdf-editor': 'pdf-editor',
}

const filters: Filter[] = ['All', 'Convert', 'Extract', 'Edit', 'Ask AI', 'Advanced']
const filterLabels: Record<Filter, string> = {
  All: 'All tools',
  Convert: 'Convert',
  Extract: 'Extract',
  Edit: 'Edit',
  'Ask AI': 'Ask AI',
  Advanced: 'Advanced',
  Favorites: 'Saved',
}

type FileKind = 'pdf' | 'word' | 'image' | 'markdown' | 'sequence' | 'other'

const MAX_FILE_SIZE = 50 * 1024 * 1024
const supportedFileExtensions = ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'md', 'markdown', 'txt', 'fasta', 'fa', 'fas']

const recommendedToolIds: Record<Exclude<FileKind, 'other'>, string[]> = {
  pdf: ['pdf-to-word', 'ai-analyzer', 'merge-pdf'],
  word: ['word-to-pdf', 'batch'],
  image: ['image-to-text', 'image-to-pdf', 'batch'],
  markdown: ['markdown-to-pdf', 'batch'],
  sequence: ['fasta-tool'],
}

function ToolIcon({ name }: { name: Tool['icon'] }) {
  const paths: Record<Tool['icon'], React.ReactNode> = {
    images: <><path d="M4 5h16v14H4z"/><circle cx="9" cy="10" r="2"/><path d="m4 16 4-4 4 4 3-3 5 5"/></>,
    camera: <><rect x="3" y="6" width="18" height="14" rx="2"/><path d="m8 6 1-2h6l1 2"/><circle cx="12" cy="13" r="4"/></>,
    word: <><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h5M9 12l1.5 5 1.5-3 1.5 3L15 12"/></>,
    document: <><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h5M9 12h6M9 16h6"/></>,
    markdown: <><path d="M3 5h18v14H3z"/><path d="M6 15V9l3 3 3-3v6M15 12h3m-1.5-2v4"/></>,
    clipboard: <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8 9h8M8 13h8M8 17h5"/></>,
    search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M10 7v6M7 10h6"/></>,
    sparkle: <path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>,
    batch: <><rect x="4" y="3" width="13" height="15" rx="2"/><path d="M8 21h10a2 2 0 0 0 2-2V7M8 8h5M8 12h5"/></>,
    dna: <><path d="M7 3c0 6 10 12 10 18M17 3C17 9 7 15 7 21M8 6h8M8 18h8M10 10h4M10 14h4"/></>,
    merge: <><rect x="3" y="3" width="10" height="12" rx="2"/><rect x="11" y="9" width="10" height="12" rx="2"/></>,
    split: <><path d="M12 3v7m0 0-6 4m6-4 6 4"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    rotate: <><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 3v4h-4"/></>,
    compress: <><rect x="8" y="8" width="8" height="8" rx="1.5"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function PdfEditorLayeredIcon() {
  return (
    <span className="home-card-layered-icon home-card-layered-icon--pdf-editor" role="img" aria-label="PDF Editor">
      <span className="home-card-layered-icon-tile home-card-layered-icon-back">
        PDF
      </span>
      <span className="home-card-layered-icon-tile home-card-layered-icon-front">
        <svg
          viewBox="0 0 24 24"
          width="19"
          height="19"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          <line x1="15" y1="5" x2="18" y2="8" strokeWidth="1.8" />
          <line x1="4" y1="21" x2="14" y2="21" strokeWidth="2.4" />
        </svg>
        <span className="home-card-layered-icon-inset" aria-hidden="true" />
      </span>
    </span>
  )
}

function DocumentAiLayeredIcon() {
  return (
    <span className="home-card-layered-icon home-card-layered-icon--document-ai" role="img" aria-label="Document AI">
      <span className="home-card-layered-icon-tile home-card-layered-icon-back">
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <line x1="7" y1="12" x2="13" y2="12" />
          <line x1="7" y1="15.5" x2="11" y2="15.5" />
        </svg>
      </span>
      <span className="home-card-layered-icon-tile home-card-layered-icon-front">
        <svg
          viewBox="0 0 24 24"
          width="21"
          height="21"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path
            d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
            strokeWidth="1.8"
          />
          <line x1="8.5" y1="10" x2="8.5" y2="12" strokeWidth="2" />
          <line x1="12" y1="8" x2="12" y2="14" strokeWidth="2.2" />
          <line x1="15.5" y1="9.5" x2="15.5" y2="12.5" strokeWidth="2" />
        </svg>
        <span className="home-card-layered-icon-inset" aria-hidden="true" />
      </span>
    </span>
  )
}

function AiAnalyserLayeredIcon() {
  const aiAnalyzerPalette = {
    '--home-icon-back-ink': '#0e7490',
    '--home-icon-back-top': '#ffffff',
    '--home-icon-back-bottom': '#eff3f6',
    '--home-icon-front-top': '#06b6d4',
    '--home-icon-front-bottom': '#0e7490',
    '--home-icon-front-shadow': 'rgba(14, 116, 144, 0.45)',
    '--home-icon-dark-back-ink': '#67e8f9',
    '--home-icon-dark-front-top': '#0e7490',
    '--home-icon-dark-front-bottom': '#155e75',
    '--home-icon-dark-front-shadow': 'rgba(8, 145, 178, 0.48)',
  } as React.CSSProperties

  return (
    <span className="home-card-layered-icon home-card-layered-icon--ai-analyzer" role="img" aria-label="AI Analyzer" style={aiAnalyzerPalette}>
      <span className="home-card-layered-icon-tile home-card-layered-icon-back">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <rect x="4" y="15" width="3" height="5" rx="0.6" />
          <rect x="8.5" y="11" width="3" height="9" rx="0.6" />
          <rect x="13" y="7" width="3" height="13" rx="0.6" />
          <rect x="17.5" y="13" width="3" height="7" rx="0.6" />
        </svg>
      </span>
      <span className="home-card-layered-icon-tile home-card-layered-icon-front">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="7" strokeWidth="2.2" />
          <line x1="16" y1="16" x2="21.5" y2="21.5" strokeWidth="2.6" />
          <polygon points="10.5,6.5 12,10.5 10.5,14.5 9,10.5" fill="currentColor" stroke="none" />
          <polygon points="6.5,10.5 10.5,12 14.5,10.5 10.5,9" fill="currentColor" stroke="none" />
        </svg>
        <span className="home-card-layered-icon-inset" aria-hidden="true" />
      </span>
    </span>
  )
}

function ImageEditorLayeredIcon() {
  const imageEditorPalette = {
    '--home-icon-back-ink': '#c2410c',
    '--home-icon-back-top': '#ffffff',
    '--home-icon-back-bottom': '#eff3f6',
    '--home-icon-front-top': '#f97316',
    '--home-icon-front-bottom': '#c2410c',
    '--home-icon-front-shadow': 'rgba(194, 65, 12, 0.45)',
    '--home-icon-dark-back-ink': '#fdba74',
    '--home-icon-dark-front-top': '#fb923c',
    '--home-icon-dark-front-bottom': '#c2410c',
    '--home-icon-dark-front-shadow': 'rgba(194, 65, 12, 0.5)',
  } as React.CSSProperties

  return (
    <span className="home-card-layered-icon home-card-layered-icon--image-editor" role="img" aria-label="Image Editor" style={imageEditorPalette}>
      <span className="home-card-layered-icon-tile home-card-layered-icon-back">
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="currentColor"
          aria-hidden="true"
        >
          <rect x="5" y="5" width="3" height="3" rx="0.6" />
          <rect x="3" y="16" width="3" height="4" rx="0.5" />
          <rect x="6" y="13" width="3" height="7" rx="0.5" />
          <rect x="9" y="10" width="3" height="10" rx="0.5" />
          <rect x="12" y="12" width="3" height="8" rx="0.5" />
          <rect x="15" y="14" width="3" height="6" rx="0.5" />
          <rect x="18" y="16" width="3" height="4" rx="0.5" />
          <rect x="18" y="5" width="2" height="2" rx="0.4" opacity="0.45" />
        </svg>
      </span>
      <span className="home-card-layered-icon-tile home-card-layered-icon-front">
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="currentColor"
          aria-hidden="true"
        >
          <rect x="3" y="7" width="2.5" height="2" rx="0.4" opacity="0.4" />
          <rect x="6.5" y="7" width="2.5" height="2" rx="0.4" opacity="0.4" />
          <rect x="10" y="5" width="4.5" height="6" rx="0.8" />
          <rect x="15.5" y="7" width="2.5" height="2" rx="0.4" opacity="0.4" />
          <rect x="19" y="7" width="2.5" height="2" rx="0.4" opacity="0.4" />
          <rect x="3" y="16" width="2.5" height="2" rx="0.4" opacity="0.4" />
          <rect x="6.5" y="14" width="4.5" height="6" rx="0.8" />
          <rect x="12" y="16" width="2.5" height="2" rx="0.4" opacity="0.4" />
          <rect x="15.5" y="16" width="2.5" height="2" rx="0.4" opacity="0.4" />
          <rect x="19" y="16" width="2.5" height="2" rx="0.4" opacity="0.4" />
        </svg>
        <span className="home-card-layered-icon-inset" aria-hidden="true" />
      </span>
    </span>
  )
}

function HomeLayeredIcon({ tool }: { tool: Tool }) {
  if (tool.id === 'pdf-editor') return <PdfEditorLayeredIcon />
  if (tool.id === 'document-ai') return <DocumentAiLayeredIcon />
  if (tool.id === 'ai-analyzer') return <AiAnalyserLayeredIcon />
  if (tool.id === 'image-editor') return <ImageEditorLayeredIcon />
  return <LayeredIcon variant={layeredIconVariants[tool.id]} />
}

function hasHomeLayeredIcon(tool: Tool) {
  return tool.id === 'pdf-editor' || tool.id === 'document-ai' || tool.id === 'image-editor' || Boolean(layeredIconVariants[tool.id])
}

function ToolCardIcon({ tool }: { tool: Tool }) {
  const layeredVariant = hasHomeLayeredIcon(tool)

  return (
    <span className={`home-tool-icon${layeredVariant ? ' home-tool-icon-layered' : ''}`}>
      {layeredVariant ? <HomeLayeredIcon tool={tool} /> : <ToolIcon name={tool.icon} />}
    </span>
  )
}

export default function Home() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('All')
  const [favorites, setFavorites] = useState<string[]>([])
  const [recents, setRecents] = useState<string[]>([])
  const [recentUndo, setRecentUndo] = useState<string[]>([])
  const [fileNote, setFileNote] = useState('Choose a file and mycloove will guide you to the right tool.')
  const [selectedFileName, setSelectedFileName] = useState('')
  const [fileKind, setFileKind] = useState<FileKind | null>(null)
  const [fileError, setFileError] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { status, enabled } = useToolAvailability()
  // The grid below maps this list. A card is included only when the catalog
  // row for that id is enabled. Home ids that differ from the quota key
  // (batch, fasta-tool) go through toolIdForHomeCard.
  const openTools = useMemo(
    () => status === 'loading' ? [] : tools.filter((tool) => enabled(toolIdForHomeCard(tool.id))),
    [enabled, status],
  )
  // Public descriptions do not depend on a client request. This is an inventory,
  // not an enabled snapshot: only a ready response can call entries available.
  // Recommendations continue to use openTools and the original gate semantics.
  const catalogueTools = status === 'ready' ? openTools : tools

  useEffect(() => {
    let frame: number | undefined
    try {
      const storedFavorites = JSON.parse(localStorage.getItem('smilepdf-favorites') || '[]')
      const storedRecents = JSON.parse(localStorage.getItem('smilepdf-recents') || '[]')
      frame = requestAnimationFrame(() => {
        setFavorites(storedFavorites)
        setRecents(storedRecents)
      })
    } catch { /* Stored preferences are optional. */ }
    return () => { if (frame !== undefined) cancelAnimationFrame(frame) }
  }, [])

  useEffect(() => {
    const focusToolSearch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      document.getElementById('tools')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      window.setTimeout(() => searchInputRef.current?.focus(), 250)
    }
    window.addEventListener('keydown', focusToolSearch)
    return () => window.removeEventListener('keydown', focusToolSearch)
  }, [])

  useEffect(() => {
    if (!recentUndo.length) return
    const timeout = window.setTimeout(() => setRecentUndo([]), 6000)
    return () => window.clearTimeout(timeout)
  }, [recentUndo])

  const visibleTools = useMemo(() => {
    const term = query.trim().toLowerCase()
    return catalogueTools.filter((tool) => {
      const matchesQuery = !term || `${tool.label} ${tool.description} ${tool.group} ${tool.badge} ${tool.format} ${tool.keywords}`.toLowerCase().includes(term)
      const matchesFilter = filter === 'All' || (filter === 'Favorites' ? favorites.includes(tool.id) : tool.group === filter)
      return matchesQuery && matchesFilter
    })
  }, [catalogueTools, favorites, filter, query])

  const filterCounts = useMemo(() => {
    const term = query.trim().toLowerCase()
    const matchingQuery = catalogueTools.filter((tool) => !term || `${tool.label} ${tool.description} ${tool.group} ${tool.badge} ${tool.format} ${tool.keywords}`.toLowerCase().includes(term))
    const counts = filters.reduce<Record<Filter, number>>((next, item) => {
      next[item] = item === 'All'
        ? matchingQuery.length
        : matchingQuery.filter((tool) => tool.group === item).length
      return next
    }, { All: 0, Convert: 0, Extract: 0, Edit: 0, 'Ask AI': 0, Advanced: 0, Favorites: 0 })
    counts.Favorites = matchingQuery.filter((tool) => favorites.includes(tool.id)).length
    return counts
  }, [catalogueTools, favorites, query])

  const toggleFavorite = (id: string) => {
    setFavorites((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
      try { localStorage.setItem('smilepdf-favorites', JSON.stringify(next)) } catch { /* Favorites remain available for this session. */ }
      return next
    })
  }

  const addRecent = (id: string) => {
    setRecentUndo([])
    setRecents((current) => {
      const next = [id, ...current.filter((item) => item !== id)].slice(0, 3)
      try { localStorage.setItem('smilepdf-recents', JSON.stringify(next)) } catch { /* Recents remain available for this session. */ }
      return next
    })
  }

  const clearRecentTools = () => {
    setRecentUndo(recents)
    setRecents([])
    try { localStorage.removeItem('smilepdf-recents') } catch { /* Local history is optional. */ }
  }

  const undoClearRecentTools = () => {
    setRecents(recentUndo)
    try { localStorage.setItem('smilepdf-recents', JSON.stringify(recentUndo)) } catch { /* Local history is optional. */ }
    setRecentUndo([])
  }

  const getFileKind = (file: File): FileKind => {
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (extension === 'pdf') return 'pdf'
    if (extension === 'doc' || extension === 'docx') return 'word'
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(extension || '')) return 'image'
    if (['md', 'markdown', 'txt'].includes(extension || '')) return 'markdown'
    if (['fasta', 'fa', 'fas'].includes(extension || '')) return 'sequence'
    return 'other'
  }

  const handleFile = (file?: File) => {
    if (!file) return
    const kind = getFileKind(file)
    const extension = file.name.split('.').pop()?.toLowerCase() || ''

    if (!supportedFileExtensions.includes(extension) || kind === 'other') {
      setSelectedFileName('')
      setFileKind(null)
      setFileError(true)
      setFileNote('That file type is not supported yet. Choose a PDF, Word, image, Markdown, text, or FASTA file.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      setSelectedFileName('')
      setFileKind(null)
      setFileError(true)
      setFileNote('That file is larger than 50 MB. Choose a smaller file to continue.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setSelectedFileName(file.name)
    setFileKind(kind)
    setFileError(false)
    setFileNote(`${file.name} is ready. Choose a recommended workspace to continue.`)
  }

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFile(event.target.files?.[0])
  }

  const clearSelectedFile = () => {
    setSelectedFileName('')
    setFileKind(null)
    setFileError(false)
    setFileNote('Choose a file and mycloove will guide you to the right tool.')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const onFileDrop = (event: ReactDragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragActive(false)
    handleFile(event.dataTransfer.files?.[0])
  }

  const recommendedTools = useMemo(() => {
    const ids = fileKind && fileKind !== 'other' ? recommendedToolIds[fileKind] : ['pdf-to-word', 'ai-analyzer', 'image-to-text']
    return ids.map((id) => openTools.find((tool) => tool.id === id)).filter((tool): tool is Tool => Boolean(tool))
  }, [fileKind, openTools])

  const quickTools = openTools.filter((tool) => ['pdf-to-word', 'image-to-text', 'ai-analyzer'].includes(tool.id))

  const fileTypeLabel = fileKind === 'pdf' ? 'PDF' : fileKind === 'word' ? 'Word document' : fileKind === 'image' ? 'image' : fileKind === 'markdown' ? 'text file' : fileKind === 'sequence' ? 'FASTA sequence' : 'document'

  const onDropzoneKeyDown = (event: React.KeyboardEvent<HTMLLabelElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      document.getElementById('heroFile')?.click()
    }
  }

  const recentTools = recents.map((id) => openTools.find((tool) => tool.id === id)).filter((tool): tool is Tool => Boolean(tool))
  const featuredTools = status === 'ready' && filter === 'All' && !query.trim() ? visibleTools.filter((tool) => tool.featured) : []
  const libraryTools = featuredTools.length ? visibleTools.filter((tool) => !tool.featured) : visibleTools

  return (
    <div className="home-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
      {/*
        The bar's "Open a file" is a button that triggers the upload pane's
        input (line ~378) through the same ref the pane uses, so the header no
        longer needs an element id on this page to reach it.
      */}
      <Topbar2
        onOpenFile={() => fileInputRef.current?.click()}
      />

      <main id="main-content" tabIndex={-1}>
        <section className="home-hero" aria-labelledby="hero-title">
          <div className="home-hero-bg" aria-hidden="true">
            <span className="home-hero-orb orb-1" />
            <span className="home-hero-orb orb-2" />
            <span className="home-hero-grid-bg" />
          </div>
          <div className="home-container home-hero-grid">
            <div className="home-hero-copy">
              <p className="home-eyebrow">Focused tools. Calm workflow.</p>
              <h1 id="hero-title"><span className="home-hero-title-line">Every document task,</span><span className="home-hero-title-line"><em>one calm workspace.</em></span></h1>
              <p className="home-lede">Convert, extract, edit, and understand your files without wrestling with a complicated app.</p>
            </div>

            <div className="home-visual">
              <QuantumCube />
            </div>
          </div>
        </section>

        <section className="home-file-workflow home-container" aria-label="File workflow">
          <div className="home-workspace-pane" aria-label="Suggested tools preview">
            <div className="home-orbit"/><div className="home-glow"/>
            <div className="home-workspace-card">
              <div className="home-workspace-header"><span className="home-window-dots" aria-hidden="true"><i/><i/><i/></span><small>YOUR WORKSPACE</small><b aria-hidden="true">•••</b></div>
              <div className="home-preview-file"><span className="home-preview-file-icon">{fileKind === 'image' ? 'IMG' : fileKind === 'word' ? 'DOC' : fileKind === 'markdown' ? 'MD' : fileKind === 'sequence' ? 'FA' : 'PDF'}</span><span><b>{selectedFileName || 'Quarterly report.pdf'}</b><small>{selectedFileName ? `${fileTypeLabel} · ready to process` : 'Your document is in good hands'}</small></span><i className="home-preview-check" aria-label="Ready">✓</i></div>
              <div className="home-preview-divider"/>
              <small className="home-preview-label">{selectedFileName ? 'Recommended next steps' : 'A simpler way to work'}</small>
              <div className="home-preview-actions">{recommendedTools.slice(0, 3).map((tool, index) => <Link href={tool.route} key={tool.id} onClick={() => addRecent(tool.id)} className={`${index === 0 ? 'primary ' : ''}accent-${tool.accent}`}><span className="preview-action-icon"><ToolIcon name={tool.icon}/></span><span><b>{tool.label}</b><small>{index === 0 ? 'Best match for your file' : tool.badge}</small></span><i aria-hidden="true">→</i></Link>)}</div>
              <div className="home-preview-footer"><span><i/> Ready when you are</span><small>File handling varies by tool</small></div>
            </div>
            <b className="home-format-pill">Smart suggestions</b>
            <small className="home-processing"><i/> Private workspace</small>
          </div>

          <div className="home-upload-pane">
            <p className="home-workflow-kicker">Start with a file</p>
            <h2>Drop it in.<br/><em>We&apos;ll guide the next step.</em></h2>
            <div className="home-hero-actions">
              <input ref={fileInputRef} id="heroFile" className="home-file-input" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif,.bmp,.md,.markdown,.txt,.fasta,.fa,.fas" onChange={onFileChange} aria-describedby="hero-file-note" />
              <label className={`home-dropzone${dragActive ? ' drag-active' : ''}${selectedFileName ? ' has-file' : ''}${fileError ? ' has-error' : ''}`} htmlFor="heroFile" tabIndex={0} role="button" aria-label={selectedFileName ? `Replace selected file, ${selectedFileName}` : 'Choose or drop a supported file'} onKeyDown={onDropzoneKeyDown} onDragEnter={(event) => { event.preventDefault(); setDragActive(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false) }} onDrop={onFileDrop}>
                <span className="home-dropzone-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4m0 0L8 8m4-4 4 4"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg></span>
                <span className="home-dropzone-copy"><b>{selectedFileName ? selectedFileName : 'Drop a file here'}</b><small>{selectedFileName ? `${fileTypeLabel} selected · ready for your next step` : 'PDF, Word, image, Markdown, or FASTA · up to 50 MB'}</small></span>
                <span className="home-dropzone-browse">{selectedFileName ? 'Replace file' : 'Browse files'} <i aria-hidden="true">↗</i></span>
              </label>
              {selectedFileName && <button type="button" className="home-file-remove" onClick={clearSelectedFile} aria-label={`Remove ${selectedFileName}`}>Remove file</button>}
            </div>
            <p id="hero-file-note" className={`home-file-note${fileError ? ' error' : ''}`} role={fileError ? 'alert' : undefined} aria-live="polite">{fileNote}</p>
            <div className="home-quick-actions" aria-label="Popular tools"><span>Popular:</span>{quickTools.map((tool) => <Link key={tool.id} href={tool.route} onClick={() => addRecent(tool.id)}>{tool.label}<i aria-hidden="true">→</i></Link>)}</div>
            <ul className="home-benefits"><li>Guest access for many tools</li><li>Review before you export</li><li>Focused document tasks</li></ul>
          </div>
        </section>

        {(recentTools.length > 0 || recentUndo.length > 0) && <section className="home-recent home-container" aria-labelledby="recent-title">
          {recentTools.length > 0 ? <>
            <div className="home-recent-heading">
              <div><p>Your workspace</p><h2 id="recent-title">Continue where you left off</h2><span>Your latest tools, ready without searching again.</span></div>
              <button className="home-recent-clear" onClick={clearRecentTools}>Clear history</button>
            </div>
            <div className="home-recent-row">{recentTools.map((tool, index) => {
              const saved = favorites.includes(tool.id)
              const layeredVariant = hasHomeLayeredIcon(tool)
              return <Link className={`home-recent-card accent-${tool.accent} ${index === 0 ? 'latest' : ''}`} href={tool.route} key={tool.id} onClick={() => addRecent(tool.id)}>
                <span className={`home-recent-icon${layeredVariant ? ' home-recent-icon-layered' : ''}`}>
                  {layeredVariant ? <HomeLayeredIcon tool={tool} /> : <ToolIcon name={tool.icon}/>}
                </span>
                <span className="home-recent-copy">
                  <small>{index === 0 ? 'Last opened' : 'Recent tool'}{saved ? ' · Saved' : ''}</small>
                  <b>{tool.label}</b>
                  <em>{tool.format}</em>
                </span>
                <span className="home-recent-open" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m6 3 5 5-5 5" /></svg></span>
              </Link>
            })}</div>
          </> : <div className="home-recent-undo" role="status">
            <span><b>Recent history cleared.</b><small>You can restore it for the next few seconds.</small></span>
            <button onClick={undoClearRecentTools}>Undo</button>
          </div>}
        </section>}

        <section className="home-tools" id="tools" aria-labelledby="tools-title">
          <div className="home-container">
            <div className="home-section-heading"><div><p>Tool library</p><h2 id="tools-title">Choose the tool.<br/>Keep the task in focus.</h2></div></div>
            <div className="home-tool-controls">
              <div className="home-search"><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg></span><input ref={searchInputRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder='Try “edit Word”, “OCR”, or “Bangla PDF”' aria-label="Search tools by task, format, or outcome" aria-controls="tool-results" />{query ? <button type="button" onClick={() => { setQuery(''); searchInputRef.current?.focus() }} aria-label="Clear search">×</button> : <kbd aria-hidden="true">Ctrl K</kbd>}</div>
              <div className="home-filter-strip">
                <div className="home-filters" role="group" aria-label="Filter tools by outcome">
                  {filters.map((item) => <button type="button" key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)} aria-pressed={filter === item} aria-controls="tool-results"><span>{filterLabels[item]}</span><small>{filterCounts[item]}</small></button>)}
                </div>
                <span className="home-filter-divider" aria-hidden="true" />
                <button type="button" className={`home-saved-filter${filter === 'Favorites' ? ' active' : ''}`} onClick={() => setFilter('Favorites')} aria-pressed={filter === 'Favorites'} aria-controls="tool-results">
                  <svg className="home-saved-icon" width="13" height="13" viewBox="0 0 24 24" fill={filter === 'Favorites' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  <span>{filterLabels.Favorites}</span>
                  <small>{filterCounts.Favorites}</small>
                </button>
              </div>
            </div>
            {featuredTools.length > 0 && <section className="home-featured aurora-section" aria-labelledby="featured-title">
              <div className="aurora-section-head">
                <div className="aurora-head-left">
                  <span className="aurora-head-tag">Recommended for you</span>
                   <h2 id="featured-title" className="aurora-head-title">Two ways to start</h2>
                </div>
                 <div className="aurora-head-right">Editing or document analysis</div>
              </div>

              <div className="aurora-grid">
                {featuredTools.map((tool) => {
                  const saved = favorites.includes(tool.id)
                  return <article className={`aurora-card accent-${tool.accent}`} key={tool.id}>
                    <div className="aurora-card-content">
                      <div className="aurora-card-stage">
                        <span className="aurora-stage-badge">{tool.featured || tool.badge}</span>
                        <span className="aurora-floating-icon aurora-floating-icon-layered" aria-hidden="true">
                          <HomeLayeredIcon tool={tool} />
                        </span>
                        <button type="button" className={`aurora-star-glass${saved ? ' saved' : ''}`} onClick={() => toggleFavorite(tool.id)} aria-label={`${saved ? 'Remove' : 'Add'} ${tool.label} ${saved ? 'from' : 'to'} saved tools`} aria-pressed={saved}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                        </button>
                      </div>
                      <h3 className="aurora-ui-title">{tool.label}</h3>
                      <p className="aurora-ui-desc">{tool.description}</p>
                      <div className="aurora-card-bottom">
                        <div className="aurora-meta-tags">
                          <span className="aurora-ui-pill">{tool.group}</span>
                          <span className="aurora-ui-pill">{tool.format}</span>
                        </div>
                        <Link className="aurora-ui-button" href={tool.route} onClick={() => addRecent(tool.id)}>
                          {tool.cta}
                          <span className="aurora-ui-button-arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg></span>
                        </Link>
                      </div>
                    </div>
                  </article>
                })}
              </div>
            </section>}

            {visibleTools.length > 0 && <div className="home-library-label home-library-label-all"><span>{status !== 'ready' ? 'Tool catalogue' : featuredTools.length ? 'Explore every tool' : filter === 'Favorites' ? 'Your saved tools' : 'Available tools'}</span><small>{libraryTools.length} {status !== 'ready' ? 'catalogue entries' : libraryTools.length === 1 ? 'workspace' : 'workspaces'}</small></div>}
            {status !== 'ready' && <p className="home-result-line" role="status">{status === 'loading' ? 'Reading live availability. Catalogue entries describe each tool, not whether it is open right now.' : 'Live availability could not be confirmed. Each workspace still checks its current limits before processing.'}</p>}
            {visibleTools.length ? <div className="home-tool-grid" id="tool-results">{libraryTools.map((tool, i) => {
              const saved = favorites.includes(tool.id)
              return <div className={`home-tool-card-entry accent-${tool.accent}`} key={tool.id} style={{ animationDelay: `${i * 45}ms` }}>
                <article className="home-tool-card">
                  <Link className="home-tool-card-link" href={tool.route} onClick={() => addRecent(tool.id)}>
                    <div className="home-tool-body">
                      <div className="home-tool-top">
                        <ToolCardIcon tool={tool}/>
                        <span className="home-tool-kind">{tool.group}</span>
                      </div>
                      <div className="home-tool-copy">
                        <h3>{tool.label}</h3>
                        <p>{tool.description}</p>
                        <span className="home-tool-format">{tool.format}</span>
                      </div>
                    </div>
                    <span className="home-tool-divider" aria-hidden="true" />
                    <footer><b><i aria-hidden="true" />{tool.badge}</b><span className="home-tool-action"><span>{status === 'ready' ? tool.cta : 'View workspace'}</span><i aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m6 3 5 5-5 5" /></svg></i></span></footer>
                  </Link>
                  <button type="button" className={`home-tool-favorite ${saved ? 'saved' : ''}`} onClick={() => toggleFavorite(tool.id)} aria-label={`${saved ? 'Remove' : 'Add'} ${tool.label} ${saved ? 'from' : 'to'} saved tools`} aria-pressed={saved}><span aria-hidden="true">{saved ? '★' : '☆'}</span></button>
                </article>
              </div>
            })}</div> : <div className="home-empty" id="tool-results"><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg></span><h3>{status === 'ready' && openTools.length === 0 ? 'Nothing is open' : filter === 'Favorites' ? 'No saved tools yet' : 'No matching tools found'}</h3><p>{status === 'ready' && openTools.length === 0 ? 'Every instrument on the bench is withdrawn. They return here when an admin opens them.' : filter === 'Favorites' ? 'Select the star on any tool to keep your everyday workflows close.' : `We could not find a tool for “${query || filter}”. Try a format such as PDF, Word, image, or OCR.`}</p><div>{filter === 'Favorites' && catalogueTools.length > 0 && <button type="button" className="home-button home-button-primary" onClick={() => setFilter('All')}>Browse all tools</button>}{catalogueTools.length > 0 && <button type="button" className="home-button home-button-secondary" onClick={() => { setQuery(''); setFilter('All'); searchInputRef.current?.focus() }}>{filter === 'Favorites' ? 'Search tools' : 'Clear and search again'}</button>}</div></div>}
          </div>
        </section>

        <section className="home-trust" id="security" aria-labelledby="trust-title"><div className="home-container home-trust-panel"><div><p>Designed for confidence</p><h2 id="trust-title">Your document.<br/>Your decision.</h2></div><article><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg></span><b>Know the file handling</b><p>Processing and retention differ by tool. Read the <Link href="/privacy">privacy policy</Link> before uploading sensitive files.</p></article><article><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg></span><b>Focused workflows</b><p>Independent tools keep each task direct and understandable.</p></article><article><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 22a8 8 0 0 1 16 0"/><path d="M19 5v6M16 8h6"/></svg></span><b>Guest access</b><p>Many tools support guest use. Some actions require an account; current limits are shown in the workspace.</p></article></div></section>
      </main>

      <HomeFooter />


    </div>
  )
}
