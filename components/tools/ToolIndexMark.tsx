import type { CSSProperties, ReactNode } from 'react'
import LayeredIcon, { type LayeredIconVariant } from './layered-icons/LayeredIcon'
import type { NavigationId } from './toolNavigation'
import styles from './ToolNavigation.module.css'

/*
  The tool index shows each destination's own card mark — the same two-tile
  layered icon the home page's tool cards carry — so a tool is recognised by
  the mark people already know, not by a second, menu-only glyph.

  Four destinations wear a home-only mark (app/page.tsx draws them inline with
  app/home.css, which tool pages never load). They are redrawn here with the
  same geometry and palettes rather than imported: the home page is the
  marketing shell's module, and its internals are not a dependency (CLAUDE.md
  §0.2). Change one, change its twin.
*/

const layeredVariant: Partial<Record<NavigationId, LayeredIconVariant>> = {
  'image-to-pdf': 'image-to-pdf',
  'pdf-to-images': 'pdf-to-images',
  'pdf-to-word': 'pdf-to-word',
  'word-to-pdf': 'word-to-pdf',
  'pdf-to-markdown': 'pdf-to-markdown',
  'markdown-to-pdf': 'markdown-to-pdf',
  'merge-pdf': 'merge-pdf',
  'split-pdf': 'split-pdf',
  'rotate-pdf': 'rotate-pdf',
  'compress-pdf': 'compress-pdf',
  'image-to-text': 'image-to-text',
  'bijoy-converter': 'bijoy-converter',
  'batch-process': 'batch',
  'fasta-tools': 'fasta-tool',
}

type Palette = Record<`--mark-${string}`, string>

function HomeMark({ palette, back, front }: { palette: Palette; back: ReactNode; front: ReactNode }) {
  return (
    <span className={styles.homeMark} style={palette as CSSProperties}>
      <span className={styles.homeBack}>{back}</span>
      <span className={styles.homeFront}>{front}<span className={styles.homeInset} /></span>
    </span>
  )
}

const pdfEditor = (
  <HomeMark
    palette={{ '--mark-ink': '#3460af', '--mark-top': '#5488e4', '--mark-bottom': '#3565bb', '--mark-shadow': 'rgba(53, 101, 187, 0.45)', '--mark-dark-ink': '#9fbff5', '--mark-dark-top': '#73a4f9', '--mark-dark-bottom': '#4c7ed6', '--mark-dark-shadow': 'rgba(76, 126, 214, 0.5)' }}
    back="PDF"
    front={(
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        <line x1="15" y1="5" x2="18" y2="8" strokeWidth="1.8" />
        <line x1="4" y1="21" x2="14" y2="21" strokeWidth="2.4" />
      </svg>
    )}
  />
)

const documentAi = (
  <HomeMark
    palette={{ '--mark-ink': '#6d28d9', '--mark-top': '#8b5cf6', '--mark-bottom': '#6d28d9', '--mark-shadow': 'rgba(109, 40, 217, 0.45)', '--mark-dark-ink': '#c4b5fd', '--mark-dark-top': '#a78bfa', '--mark-dark-bottom': '#7c3aed', '--mark-dark-shadow': 'rgba(124, 58, 237, 0.48)' }}
    back={(
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <line x1="7" y1="12" x2="13" y2="12" />
        <line x1="7" y1="15.5" x2="11" y2="15.5" />
      </svg>
    )}
    front={(
      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" strokeWidth="1.8" />
        <line x1="8.5" y1="10" x2="8.5" y2="12" strokeWidth="2" />
        <line x1="12" y1="8" x2="12" y2="14" strokeWidth="2.2" />
        <line x1="15.5" y1="9.5" x2="15.5" y2="12.5" strokeWidth="2" />
      </svg>
    )}
  />
)

const aiAnalyzer = (
  <HomeMark
    palette={{ '--mark-ink': '#0e7490', '--mark-top': '#06b6d4', '--mark-bottom': '#0e7490', '--mark-shadow': 'rgba(14, 116, 144, 0.45)', '--mark-dark-ink': '#67e8f9', '--mark-dark-top': '#0e7490', '--mark-dark-bottom': '#155e75', '--mark-dark-shadow': 'rgba(8, 145, 178, 0.48)' }}
    back={(
      <svg viewBox="0 0 24 24" fill="currentColor">
        <rect x="4" y="15" width="3" height="5" rx="0.6" />
        <rect x="8.5" y="11" width="3" height="9" rx="0.6" />
        <rect x="13" y="7" width="3" height="13" rx="0.6" />
        <rect x="17.5" y="13" width="3" height="7" rx="0.6" />
      </svg>
    )}
    front={(
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10.5" cy="10.5" r="7" strokeWidth="2.2" />
        <line x1="16" y1="16" x2="21.5" y2="21.5" strokeWidth="2.6" />
        <polygon points="10.5,6.5 12,10.5 10.5,14.5 9,10.5" fill="currentColor" stroke="none" />
        <polygon points="6.5,10.5 10.5,12 14.5,10.5 10.5,9" fill="currentColor" stroke="none" />
      </svg>
    )}
  />
)

const imageEditor = (
  <HomeMark
    palette={{ '--mark-ink': '#c2410c', '--mark-top': '#f97316', '--mark-bottom': '#c2410c', '--mark-shadow': 'rgba(194, 65, 12, 0.45)', '--mark-dark-ink': '#fdba74', '--mark-dark-top': '#fb923c', '--mark-dark-bottom': '#c2410c', '--mark-dark-shadow': 'rgba(194, 65, 12, 0.5)' }}
    back={(
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <rect x="5" y="5" width="3" height="3" rx="0.6" />
        <rect x="3" y="16" width="3" height="4" rx="0.5" />
        <rect x="6" y="13" width="3" height="7" rx="0.5" />
        <rect x="9" y="10" width="3" height="10" rx="0.5" />
        <rect x="12" y="12" width="3" height="8" rx="0.5" />
        <rect x="15" y="14" width="3" height="6" rx="0.5" />
        <rect x="18" y="16" width="3" height="4" rx="0.5" />
        <rect x="18" y="5" width="2" height="2" rx="0.4" opacity="0.45" />
      </svg>
    )}
    front={(
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
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
    )}
  />
)

const homeMarks: Partial<Record<NavigationId, ReactNode>> = {
  'pdf-editor': pdfEditor,
  'document-ai': documentAi,
  'ai-analyzer': aiAnalyzer,
  'image-editor': imageEditor,
}

/** A destination's card mark, sized by the caller's `.mark` box. Always decorative: the link carries the name. */
export default function ToolIndexMark({ id }: { id: NavigationId }) {
  const variant = layeredVariant[id]
  return (
    <span className={styles.markScale} aria-hidden="true">
      {homeMarks[id] ?? (variant ? <LayeredIcon variant={variant} /> : null)}
    </span>
  )
}
