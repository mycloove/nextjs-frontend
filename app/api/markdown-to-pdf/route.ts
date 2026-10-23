import { NextRequest, NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { microserviceFetch, microserviceUrl } from '@/lib/usage/internal'

const FORWARDED_TEXT_FIELDS = [
  'rendered_html',
  'rendered_css',
  'expected_diagram_count',
  'rendered_diagram_count',
  'export_contract_version',
] as const

function backendCandidates(configuredUrl: string): string[] {
  const candidates = [configuredUrl.replace(/\/$/, '')]
  if (process.env.NODE_ENV === 'development') {
    for (const localUrl of ['http://localhost:5000', 'http://127.0.0.1:5000']) {
      if (!candidates.includes(localUrl)) candidates.push(localUrl)
    }
  }
  return candidates
}

export async function POST(request: NextRequest) {
  let quota: Awaited<ReturnType<typeof beginToolQuota>> | undefined
  try {
    const formData = await request.formData()
    const mdFile = formData.get('md_file') as File

    if (!mdFile) {
      return NextResponse.json(
        { error: 'No Markdown file provided' },
        { status: 400 }
      )
    }

    const pageSize = formData.get('page_size') || 'A4'
    const fontSize = formData.get('font_size') || '12'
    const includeToc = formData.get('include_toc') || 'false'
    const syntaxHighlight = formData.get('syntax_highlight') || 'true'
    const lang = formData.get('lang') || 'auto'

    quota = await beginToolQuota(request, 'markdown-to-pdf', formData)
    if (!quota.ok) return quota.response

    const createForwardFormData = () => {
      const forwarded = new FormData()
      forwarded.append('md_file', mdFile)
      forwarded.append('page_size', pageSize as string)
      forwarded.append('font_size', fontSize as string)
      forwarded.append('include_toc', includeToc as string)
      forwarded.append('syntax_highlight', syntaxHighlight as string)
      forwarded.append('lang', lang as string)
      for (const field of FORWARDED_TEXT_FIELDS) {
        const value = formData.get(field)
        if (typeof value === 'string') forwarded.append(field, value)
      }
      return forwarded
    }

    let response: Response | undefined
    let lastTransportError: unknown
    for (const candidate of backendCandidates(microserviceUrl())) {
      try {
        response = await microserviceFetch(`${candidate}/convert/markdown-to-pdf`, {
          method: 'POST',
          body: createForwardFormData(),
        })
        if (response.status !== 502 && response.status !== 503) break
      } catch (error) {
        lastTransportError = error
      }
    }

    if (!response) throw lastTransportError || new Error('PDF conversion service is unavailable')

    if (!response.ok) {
      let errorMessage = 'Conversion failed'
      try {
        const errorText = await response.text()
        if (errorText) {
          try {
            const error = JSON.parse(errorText)
            errorMessage = error?.error || errorText
          } catch {
            errorMessage = errorText
          }
        }
      } catch {
        // Keep the stable fallback when the upstream response body is unreadable.
      }
      return quota.apply(NextResponse.json({ error: errorMessage }, { status: response.status }))
    }

    const pdfBytes = new Uint8Array(await response.arrayBuffer())
    const pdfSignature = new TextDecoder('ascii').decode(pdfBytes.subarray(0, 5))
    if (pdfBytes.byteLength < 5 || pdfSignature !== '%PDF-') {
      return quota.apply(NextResponse.json(
        { error: 'PDF renderer returned an empty or invalid document; no download was generated' },
        { status: 502 }
      ))
    }

    return quota.apply(new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': response.headers.get('content-disposition') || 'attachment; filename="mycloove_converted.pdf"',
        'Content-Length': String(pdfBytes.byteLength),
        'Cache-Control': 'no-store',
      },
    }), { successful: true, fileName: null })

  } catch (error) {
    console.error('Error:', error)
    const response = NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to convert Markdown to PDF' },
      { status: 500 }
    )
    return quota?.ok ? quota.apply(response) : response
  }
}
