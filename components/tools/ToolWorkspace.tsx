'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { type ComponentType } from 'react'
import { getTool, type ToolId } from '@/lib/tools/registry'
import AnimatedBrandLogo from '@/components/animated-brand-logo/AnimatedBrandLogo'
import AuthNavButton from '@/components/AuthNavButton'
import LayeredIcon, { type LayeredIconVariant } from '@/components/tools/layered-icons/LayeredIcon'
import { HelixLoader } from '@/components/tools/HelixLoader'
import UsageMeter from '@/components/tools/UsageMeter'
import WithdrawnTool from '@/components/tools/WithdrawnTool'
import { useToolAvailability } from '@/lib/usage/useToolAvailability'
import styles from './ToolWorkspace.module.css'

const components: Record<ToolId, ComponentType> = {
  'image-to-pdf': dynamic(() => import('@/features/image-to-pdf')),
  'pdf-to-images': dynamic(() => import('@/features/pdf-to-images')),
  'pdf-to-word': dynamic(() => import('@/features/pdf-to-word')),
  'word-to-pdf': dynamic(() => import('@/features/word-to-pdf')),
  'image-to-text': dynamic(() => import('@/features/image-to-text')),
  'pdf-to-markdown': dynamic(() => import('@/features/pdf-to-markdown')),
  'markdown-to-pdf': dynamic(() => import('@/features/markdown-to-pdf')),
  'ai-analyzer': dynamic(() => import('@/features/ai-analyzer')),
  'batch-process': dynamic(() => import('@/features/batch-process')),
  'fasta-tools': dynamic(() => import('@/features/fasta-tools'), {
    loading: () => (
      <div className={styles.toolMountLoading}>
        <HelixLoader size={40} tone="bases" label="Loading FASTA workspace…" />
      </div>
    ),
  }),
  'bijoy-converter': dynamic(() => import('@/features/bijoy-converter')),
  'merge-pdf': dynamic(() => import('@/features/merge-pdf')),
  'split-pdf': dynamic(() => import('@/features/split-pdf')),
  'rotate-pdf': dynamic(() => import('@/features/rotate-pdf')),
  'compress-pdf': dynamic(() => import('@/features/compress-pdf')),
}

/* mycloove brand chrome — the same topbar treatment as the Image Editor
   ([octopus] / mycloove / page). The old "SmilePDF"/"ASTRUM" roots were stale
   branding. ToolId is a closed union, so this record fails typecheck when a
   tool is added. */
const layeredIconVariants: Record<ToolId, LayeredIconVariant> = {
  'image-to-pdf': 'image-to-pdf',
  'pdf-to-images': 'pdf-to-images',
  'pdf-to-word': 'pdf-to-word',
  'word-to-pdf': 'word-to-pdf',
  'image-to-text': 'image-to-text',
  'pdf-to-markdown': 'pdf-to-markdown',
  'markdown-to-pdf': 'markdown-to-pdf',
  'ai-analyzer': 'ai-analyzer',
  'batch-process': 'batch',
  'fasta-tools': 'fasta-tool',
  'bijoy-converter': 'bijoy-converter',
  'merge-pdf': 'merge-pdf',
  'split-pdf': 'split-pdf',
  'rotate-pdf': 'rotate-pdf',
  'compress-pdf': 'compress-pdf',
}

export default function ToolWorkspace({
  toolId,
  topbarVariant,
  hideHeading,
}: {
  toolId: ToolId
  topbarVariant?: 'aligned'
  /* Opt-in: drop the whole heading row — the layered identity mark, the group
     eyebrow, the tool title and the description — leaving the tool surface as
     the page's only content. /rotate-pdf and /pdf-to-word use this when their
     dedicated surface carries the visual identity; registry strings stay
     untouched as SEO metadata (toolMetadata), and .toolSurface keeps the label
     as its accessible region name. Default false keeps every other tool's
     heading and DOM unchanged. */
  hideHeading?: boolean
}) {
  const tool = getTool(toolId)
  const Tool = components[toolId]
  const { ready, enabled } = useToolAvailability()
  const withdrawn = ready && !enabled(toolId)

  /* Rotate PDF opts into the split-pdf "aligned frame" topbar
     (topbarVariant="aligned"): the bar becomes a frame around the 1280px
     content column and "All tools" grows the grid icon — split-pdf parity.
     The default — today's full-bleed bar — is kept intact for every other
     ToolWorkspace tool, so this branch must stay additive (conditionals only,
     no change to the default DOM). */
  const aligned = topbarVariant === 'aligned'

  const breadcrumb = (
    <div className={styles.breadcrumb}>
      <Link href="/" className={styles.brand} aria-label="mycloove home">
        <AnimatedBrandLogo />
      </Link>
      <span className={styles.sep} aria-hidden="true">/</span>
      <span className={styles.brandName}>mycloove</span>
      <span className={styles.sep} aria-hidden="true">/</span>
      <b>{tool.label}</b>
    </div>
  )

  const topbarEnd = (
    <div className={styles.topbarEnd}>
      <UsageMeter toolId={toolId} />
      <Link
        className={`${styles.dashboardLink} ${toolId === 'merge-pdf' ? styles.dashboardLinkMerge : ''}`}
        href="/"
      >
        {/* Default keeps a bare text child (byte-identical to the pre-variant
            markup); the aligned variant and merge-pdf prepend the grid icon. */}
        {aligned || toolId === 'merge-pdf' ? (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            All tools
          </>
        ) : (
          'All tools'
        )}
      </Link>
      {/* The signed-in account control (avatar + profile slide-over) sits at the
          far right on every (tools) page. chrome="tool" styles the logged-out
          link from the profile module, since tool topbars do not import
          home.css. Additive: the rest of the bar is unchanged. */}
      <AuthNavButton chrome="tool" />
    </div>
  )

  return (
    <div className={`${styles.shell} ${toolId === 'merge-pdf' ? styles.shellMerge : ''}`}>
      <section className={styles.main}>
        <header
          className={`${styles.topbar} ${aligned ? styles.topbarAligned : ''} ${toolId === 'merge-pdf' ? styles.topbarMerge : ''}`}
        >
          {aligned ? (
            <div className={styles.topbarInner}>{breadcrumb}{topbarEnd}</div>
          ) : (
            <>{breadcrumb}{topbarEnd}</>
          )}
        </header>
        <main className={`${styles.content} ${toolId === 'merge-pdf' ? styles.contentMerge : ''}`}>
          {/* hideHeading: the whole identity row — the layered mark, the
              "Convert" eyebrow, the tool title and the description — is
              skipped, leaving the tool surface as the page's only content.
              Opt-in pages use this when their surface provides the visual
              identity; every other tool keeps its heading and description. */}
          {hideHeading || toolId === 'merge-pdf' || toolId === 'pdf-to-images' ? null : (
            <div className={styles.heading}>
              {/* Same layered identity as the home tool card. The wrapper is
                  aria-hidden because the h1 right after it already carries the
                  tool name. It MUST carry .headingIcon: a bare span here would
                  match the `.heading div span` description rule's old unscoped
                  form (`\`.heading span\``) and inherit margin-top/display/font
                  styles that pushed the icon 7px below the text centre. */}
              <span className={styles.headingIcon} aria-hidden="true"><LayeredIcon variant={layeredIconVariants[toolId]} /></span>
              <div><p>{tool.group}</p><h1>{tool.label}</h1><span>{tool.description}</span></div>
              {tool.badge && <em>{tool.badge}</em>}
            </div>
          )}
          <section className={`${styles.toolSurface} ${toolId === 'merge-pdf' ? styles.toolSurfaceMerge : ''}`} aria-label={`${tool.label} workspace`}>
            {withdrawn ? <WithdrawnTool compact label={tool.label} /> : <Tool />}
          </section>
        </main>
      </section>
    </div>
  )
}
