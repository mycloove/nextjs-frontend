import ToolWorkspace from '@/components/tools/ToolWorkspace'
import { toolMetadata } from '@/lib/tools/registry'
export const metadata = toolMetadata('pdf-to-images')
export default function Page() { return <ToolWorkspace toolId="pdf-to-images" /> }
