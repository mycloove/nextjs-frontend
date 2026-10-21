import { JetBrains_Mono } from 'next/font/google'
import CompressPdfTool from '@/features/compress-pdf'
import { toolMetadata } from '@/lib/tools/registry'

export const metadata = toolMetadata('compress-pdf')

/* Full-screen chrome exception (CLAUDE.md §2, the same shape as /mr-markdown
   and /split-pdf): the compression console owns its whole page — its own nav
   band with the mycloove mark, the target-mass visualizer and the engine
   controls — so it bypasses ToolWorkspace. The registry + ToolWorkspace
   entries stay untouched, so the lazy-import path for this tool still exists.
   JetBrains Mono is the console face, scoped to this route via a CSS
   variable, exactly the way the Split workbench loads its identity fonts. */
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
})

export default function Page() {
  return (
    <div className={jetbrainsMono.variable}>
      <CompressPdfTool />
    </div>
  )
}
