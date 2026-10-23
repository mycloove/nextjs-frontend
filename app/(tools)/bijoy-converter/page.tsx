import ToolWorkspace from '@/components/tools/ToolWorkspace'
import { toolMetadata } from '@/lib/tools/registry'
import Link from 'next/link'

export const metadata = toolMetadata('bijoy-converter')

export default function Page() {
  /* The generic ToolWorkspace heading — the "Extract" eyebrow, the tool title,
     the description and the layered identity mark — is retired for this tool.
     The registry strings still ship as the SEO metadata via toolMetadata above,
     and .toolSurface keeps the label as its accessible region name. Bijoy →
     Unicode builds its own instrument header inside the component so the page
     reads as one dedicated surface; every other tool keeps the default heading
     (hideHeading defaults to false), the same additive switch rotate-pdf owns. */
  return (
    <>
      <ToolWorkspace toolId="bijoy-converter" hideHeading />
      <section aria-labelledby="bijoy-about" className="mx-auto max-w-7xl px-4 py-12 md:px-8" style={{ color: 'var(--text-primary)' }}>
        <h2 id="bijoy-about" className="mb-6 text-2xl font-semibold">Bijoy to Unicode for Bangla text</h2>
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="mb-3 font-semibold">Make legacy text reusable</h3>
            <p className="text-sm leading-7">Paste Bijoy-encoded text into the source field, convert it, and compare the Unicode result with the original before copying or downloading. The tool converts text encoding; it does not read letters from a photo.</p>
            <p lang="bn" className="mt-4 text-sm leading-7">পুরোনো বিজয় লেখা ইউনিকোডে রূপান্তর করার পরে বানান, যুক্তাক্ষর ও যতিচিহ্ন মূল লেখার সঙ্গে মিলিয়ে নিন। ছবি বা স্ক্যানের জন্য OCR দরকার।</p>
          </div>
          <div>
            <h3 className="mb-3 font-semibold">Check the source first</h3>
            <p className="text-sm leading-7">Unicode text, damaged copy-paste output, and scanned pages are different problems. A font change alone does not convert Bijoy encoding, and not every damaged document can be recovered.</p>
            <p className="mt-4 text-sm leading-7">For scans use <Link href="/image-to-text" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Image to Text</Link>. For a PDF-to-Markdown workflow use <Link href="/mr-markdown" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Mr. Markdown by mycloove</Link>. Current availability and limits are checked in each workspace.</p>
          </div>
        </div>
      </section>
    </>
  )
}
