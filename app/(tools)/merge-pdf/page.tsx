import ToolWorkspace from '@/components/tools/ToolWorkspace'
import { toolMetadata } from '@/lib/tools/registry'

export const metadata = toolMetadata('merge-pdf')

export default function Page() {
  return <ToolWorkspace toolId="merge-pdf" />
}
