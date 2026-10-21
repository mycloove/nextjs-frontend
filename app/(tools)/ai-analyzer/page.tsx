import ToolWorkspace from '@/components/tools/ToolWorkspace'
import { toolMetadata } from '@/lib/tools/registry'

export const metadata = toolMetadata('ai-analyzer')

/* Opt out of the generic heading row (AI eyebrow / "AI Analyzer" title /
   description / "AI powered" badge). The registry strings still ship as the SEO
   metadata via toolMetadata above, the topbar breadcrumb keeps the tool name
   visible, and .toolSurface keeps the label as its accessible region name. The
   component carries its own bespoke "The Reader" masthead instead, so the page
   body is the instrument alone. Same additive discipline as rotate-pdf: only
   this page passes hideHeading, so every other tool's DOM is unchanged. */
export default function Page() { return <ToolWorkspace toolId="ai-analyzer" hideHeading /> }
