import ToolWorkspace from '@/components/tools/ToolWorkspace'
import { toolMetadata } from '@/lib/tools/registry'
export const metadata = toolMetadata('image-to-pdf')
/* hideHeading: the visible "Convert / Images to PDF / Combine images into one
   PDF document." row is dropped — same additive mechanism /rotate-pdf uses —
   and the tool surface owns its own instrument header (the Light Table).
   The registry `description` stays untouched because it is the SEO metadata
   payload (`toolMetadata`), not page copy. */
export default function Page() { return <ToolWorkspace toolId="image-to-pdf" hideHeading /> }
