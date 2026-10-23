import { JetBrains_Mono, Noto_Sans_Bengali } from 'next/font/google'
import PDFToMarkdown from '@/components/PDFToMarkdown'
import WithdrawnTool from '@/components/tools/WithdrawnTool'
import { toolMetadata } from '@/lib/tools/registry'
import { isToolOpen } from '@/lib/usage/controls'
import MrMarkdownPublicInfo from './MrMarkdownPublicInfo'
export const metadata = toolMetadata('pdf-to-markdown')

/* Entry-screen identity fonts. Loaded here (not in the root layout) so they
   reach only this route; the editor workspace keeps resolving --pm-font-mono
   to its previous OS fallback because next/font registers a hashed family
   name exposed only through these CSS variables. */
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
})

const notoSansBengali = Noto_Sans_Bengali({
  subsets: ['bengali'],
  display: 'swap',
  variable: '--font-noto-bengali',
})

export default async function Page() {
  const open = await isToolOpen('pdf-to-markdown')
  if (!open) {
    return <WithdrawnTool label="Mr. Markdown" />
  }
  return (
    <div className={`${jetbrainsMono.variable} ${notoSansBengali.variable}`}>
      <PDFToMarkdown publicInfo={<MrMarkdownPublicInfo />} />
    </div>
  )
}
