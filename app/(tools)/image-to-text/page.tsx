import ToolWorkspace from '@/components/tools/ToolWorkspace'
import { toolMetadata } from '@/lib/tools/registry'
export const metadata = toolMetadata('image-to-text')
export default function Page() { return <ToolWorkspace toolId="image-to-text" hideHeading /> }
