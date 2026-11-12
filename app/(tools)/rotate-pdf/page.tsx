import ToolWorkspace from '@/components/tools/ToolWorkspace'
import { toolMetadata } from '@/lib/tools/registry'

export const metadata = toolMetadata('rotate-pdf')

export default function Page() {
  /* Hide the whole heading — the page body is the tool surface alone
     (dropzone and controls); no identity mark, "Convert" eyebrow or title.
     The registry strings still ship as the SEO metadata via toolMetadata
     above, and .toolSurface keeps the label as its accessible region name.
     The bar is the same tool header every tool shares. */
  return <ToolWorkspace toolId="rotate-pdf" hideHeading />
}
