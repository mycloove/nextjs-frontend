import ToolWorkspace from '@/components/tools/ToolWorkspace'
import { toolMetadata } from '@/lib/tools/registry'
export const metadata = toolMetadata('batch-process')
export default function Page() {
  /* Opt into hideHeading: the heading row — the layered batch mark, the
     "Advanced" eyebrow, the title and the description — is dropped, so the
     dispatch surface is the page's only content. The registry strings still
     ship as the SEO metadata via toolMetadata above, and .toolSurface keeps
     "Batch Process workspace" as the accessible region name. Same additive
     discipline as /rotate-pdf: a ToolWorkspace prop, nothing shared edited. */
  return <ToolWorkspace toolId="batch-process" hideHeading />
}
