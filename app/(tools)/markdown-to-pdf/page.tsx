import ToolWorkspace from '@/components/tools/ToolWorkspace'
import { toolMetadata } from '@/lib/tools/registry'
export const metadata = toolMetadata('markdown-to-pdf')
export default function Page() { return <ToolWorkspace toolId="markdown-to-pdf" /> }
