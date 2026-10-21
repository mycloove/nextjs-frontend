import { Fraunces, JetBrains_Mono } from 'next/font/google'
import SplitPdfTool from '@/features/split-pdf'
import { toolMetadata } from '@/lib/tools/registry'

export const metadata = toolMetadata('split-pdf')

/* Full-screen chrome exception (CLAUDE.md §2, same shape as /mr-markdown):
   the Split workbench owns its whole page — the "cutting mat" layout — so it
   bypasses ToolWorkspace. The ToolWorkspace + registry entries stay, so the
   lazy import path still exists. Fraunces (display serif) and JetBrains Mono
   are loaded here, scoped to this route via CSS variables, exactly the way
   the Mr. Markdown page loads its identity fonts. */
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  axes: ['opsz'],
  variable: '--font-fraunces',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
})

export default function Page() {
  return (
    <div className={`${fraunces.variable} ${jetbrainsMono.variable}`}>
      <SplitPdfTool />
    </div>
  )
}
