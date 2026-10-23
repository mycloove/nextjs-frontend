import ToolWorkspace from '@/components/tools/ToolWorkspace'
import { toolMetadata } from '@/lib/tools/registry'
import Link from 'next/link'
export const metadata = toolMetadata('image-to-text')
export default function Page() {
  return (
    <>
      <ToolWorkspace toolId="image-to-text" hideHeading />
      <section aria-labelledby="ocr-about" className="mx-auto max-w-7xl px-4 py-12 md:px-8" style={{ color: 'var(--text-primary)' }}>
        <h2 id="ocr-about" className="mb-6 text-2xl font-semibold">Image to Text: turn a scan into editable writing</h2>
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="mb-3 font-semibold">A practical OCR workflow</h3>
            <p className="text-sm leading-7">Before uploading, crop unnecessary edges in your image editor. Choose a supported photo, screenshot, or scan and select the language options available in the workspace. Run recognition, then review the extracted text before copying or exporting.</p>
            <p lang="bn" className="mt-4 text-sm leading-7">ছবি থেকে বাংলা লেখা পেতে পরিষ্কার, সোজা ও ভালো আলোতে তোলা ছবি ব্যবহার করুন। বাংলা ভাষার বিকল্প বেছে নিলেও ফলাফল মিলিয়ে নিন; OCR-এর ভাষা-সাপোর্ট সার্ভারের ইনস্টল করা মডেলের ওপর নির্ভর করে।</p>
          </div>
          <div>
            <h3 className="mb-3 font-semibold">Recognition is not transcription certainty</h3>
            <p className="text-sm leading-7">Blur, handwriting, small letters, mixed languages, and complex layouts can introduce errors. Check names, numbers, punctuation, and Bangla conjuncts against the source. OCR does not guarantee the original page layout.</p>
            <p className="mt-4 text-sm leading-7">If your source is already legacy Bangla text rather than an image, try <Link href="/bijoy-converter" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Bijoy to Unicode</Link>. For an editable document from a PDF, see <Link href="/pdf-to-word" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">PDF to Word</Link>.</p>
          </div>
        </div>
      </section>
    </>
  )
}
