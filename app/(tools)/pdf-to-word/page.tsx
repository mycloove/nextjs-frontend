import ToolWorkspace from '@/components/tools/ToolWorkspace'
import { toolMetadata } from '@/lib/tools/registry'
import Link from 'next/link'
export const metadata = toolMetadata('pdf-to-word')
export default function Page() {
  return (
    <>
      <ToolWorkspace toolId="pdf-to-word" hideHeading />
      <section aria-labelledby="pdf-word-about" className="mx-auto max-w-7xl px-4 py-12 md:px-8" style={{ color: 'var(--text-primary)' }}>
        <h2 id="pdf-word-about" className="mb-6 text-2xl font-semibold">PDF to Word: work with the text again</h2>
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="mb-3 font-semibold">PDF input, editable DOCX output</h3>
            <p className="text-sm leading-7">Choose a PDF, run conversion, and download the Word document when it is ready. Open the DOCX in your editor and review page breaks, tables, columns, and fonts before continuing your work.</p>
            <p lang="bn" className="mt-4 text-sm leading-7">পিডিএফ থেকে ওয়ার্ডে রূপান্তরের পরে বাংলা অক্ষর, টেবিল ও পৃষ্ঠার বিন্যাস যাচাই করুন। স্ক্যান করা পৃষ্ঠা আর selectable text-সহ PDF একইভাবে রূপান্তর হয় না।</p>
          </div>
          <div>
            <h3 className="mb-3 font-semibold">Text PDFs and scans need different checks</h3>
            <p className="text-sm leading-7">Text-based PDFs are different from scanned pages. OCR can recover writing from scans, but that path may rebuild paragraphs rather than preserve the original tables and layout. Password protection and complex formatting can also affect conversion.</p>
            <p className="mt-4 text-sm leading-7">For plain text from a scan, use <Link href="/image-to-text" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Image to Text</Link>. For structured Markdown editing, use <Link href="/mr-markdown" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Mr. Markdown by mycloove</Link>. Review the <Link href="/privacy" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">file-handling policy</Link> before uploading sensitive content.</p>
          </div>
        </div>
      </section>
    </>
  )
}
