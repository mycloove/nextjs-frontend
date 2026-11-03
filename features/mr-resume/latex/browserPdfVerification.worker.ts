import { verifyBrowserLatexPdf } from './browserPdfVerification.ts'

const worker = self as unknown as { onmessage: ((event: MessageEvent<unknown>) => void) | null; postMessage: (value: unknown) => void }
worker.onmessage = async ({ data }: MessageEvent<unknown>) => {
  try {
    const result = await verifyBrowserLatexPdf(data as ArrayBuffer)
    worker.postMessage({ ok: true, result })
  } catch (error) {
    worker.postMessage({ ok: false, error: error instanceof Error ? error.message : 'The compiler PDF could not be verified.' })
  }
}
