import ToolWorkspace from '@/components/tools/ToolWorkspace'
import { toolMetadata } from '@/lib/tools/registry'

export const metadata = toolMetadata('word-to-pdf')

/* Opt out of the generic heading row ("Convert" eyebrow / "Word to PDF" title /
   "Create polished PDFs from Word documents." description + layered icon). The
   registry strings still ship as the SEO metadata via toolMetadata above, the
   topbar breadcrumb keeps the tool name visible, and .toolSurface keeps the
   label as its accessible region name — the bench itself carries the identity
   (its spec line reads "DOCX · MAX 50 MB · PDF OUT"). Same additive discipline
   as rotate-pdf / image-to-pdf: only this page passes hideHeading, so every
   other tool's DOM is unchanged. */
export default function Page() { return <ToolWorkspace toolId="word-to-pdf" hideHeading /> }
