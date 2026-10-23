'use client'

import dynamic from 'next/dynamic'
import { type ComponentType } from 'react'
import { getTool, type ToolId } from '@/lib/tools/registry'
import LayeredIcon, { type LayeredIconVariant } from '@/components/tools/layered-icons/LayeredIcon'
import { HelixLoader } from '@/components/tools/HelixLoader'
import CreditCost from '@/components/tools/CreditCost'
import { useAccountViewer } from '@/lib/account/useAccountViewer'
import { useCreditBalance } from '@/lib/usage/useCreditBalance'
import WithdrawnTool from '@/components/tools/WithdrawnTool'
import { useToolAvailability } from '@/lib/usage/useToolAvailability'
import ToolNavbar from './ToolNavbar'
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

/* The existing heading identity stays independent of the navigation index.
   ToolId is closed, so new tools still require their own identity mapping. */
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
  const account = useAccountViewer()
  const credits = useCreditBalance(account.status === 'loading' ? null : account.viewer?.id ?? 'guest')
  const tool = getTool(toolId)
  const Tool = components[toolId]
  const availability = useToolAvailability()
  const { ready, enabled } = availability
  const withdrawn = ready && !enabled(toolId)

  /* Preserve Rotate PDF's aligned 1280px frame. Navigation changes do not
     alter the content geometry, availability gate, or dynamic tool mount. */
  const aligned = topbarVariant === 'aligned'

  return (
    <div className={`${styles.shell} ${toolId === 'merge-pdf' ? styles.shellMerge : ''}`}>
      <section className={styles.main}>
        <ToolNavbar toolId={toolId} aligned={aligned} accountState={account} creditState={credits} availability={availability} />
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
            {!withdrawn && <CreditCost toolId={toolId} creditState={credits} />}
            {withdrawn ? <WithdrawnTool compact label={tool.label} /> : <Tool />}
          </section>
        </main>
      </section>
    </div>
  )
}
