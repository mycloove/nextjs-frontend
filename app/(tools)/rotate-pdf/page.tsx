import ToolWorkspace from '@/components/tools/ToolWorkspace'
import { toolMetadata } from '@/lib/tools/registry'

export const metadata = toolMetadata('rotate-pdf')

export default function Page() {
  /* Opt into the split-pdf-style "aligned frame" topbar (see ToolWorkspace's
     topbarVariant), and hide the whole heading — the page body is the tool
     surface alone (dropzone and controls); no identity mark, "Convert"
     eyebrow or title. The registry strings still ship as the SEO metadata via
     toolMetadata above, and .toolSurface keeps the label as its accessible
     region name. Every other ToolWorkspace tool keeps its default bar and
     full heading, so this is a /rotate-pdf-only change. */
  return <ToolWorkspace toolId="rotate-pdf" topbarVariant="aligned" hideHeading />
}
