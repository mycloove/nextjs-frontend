import ToolWorkspace from '@/components/tools/ToolWorkspace'
import { toolMetadata } from '@/lib/tools/registry'

export const metadata = toolMetadata('bijoy-converter')

export default function Page() {
  /* The generic ToolWorkspace heading — the "Extract" eyebrow, the tool title,
     the description and the layered identity mark — is retired for this tool.
     The registry strings still ship as the SEO metadata via toolMetadata above,
     and .toolSurface keeps the label as its accessible region name. Bijoy →
     Unicode builds its own instrument header inside the component so the page
     reads as one dedicated surface; every other tool keeps the default heading
     (hideHeading defaults to false), the same additive switch rotate-pdf owns. */
  return <ToolWorkspace toolId="bijoy-converter" hideHeading />
}
