import ToolWorkspace from '@/components/tools/ToolWorkspace'
import { toolMetadata } from '@/lib/tools/registry'
export const metadata = toolMetadata('fasta-tools')
/* The chromatogram intake card is this page's identity and already names the
   tool, so the chrome heading (layered icon + eyebrow + title + description) is
   dropped via the same additive hideHeading switch rotate-pdf uses. SEO
   metadata still comes from toolMetadata. */
export default function Page() { return <ToolWorkspace toolId="fasta-tools" hideHeading /> }
