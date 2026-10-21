import { ImageResponse } from 'next/og'

/**
 * Branded OpenGraph/Twitter card for every route (root segment default). The
 * card states what the product is in one line — the same promise as the home
 * hero — so a shared link reads as a real product, not a bare URL.
 *
 * Rendered in the default Node runtime (not edge) so it stays compatible with
 * the production image's `output: 'standalone'`.
 */
export const alt = 'mycloove — Calm document tools'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: 'linear-gradient(135deg, #0b0d12 0%, #141826 55%, #1c2234 100%)',
          color: '#f3f4f8',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 30,
              fontWeight: 700,
              background: 'rgba(109, 158, 235, 0.16)',
              border: '1px solid rgba(109, 158, 235, 0.5)',
              color: '#8fb4f2',
            }}
          >
            m
          </div>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.5 }}>mycloove</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, maxWidth: 900 }}>
            Every document task, one calm workspace.
          </div>
          <div style={{ fontSize: 28, color: '#a9b1c6', maxWidth: 900 }}>
            Convert, extract, edit, and understand PDF, Word, image, Markdown, and FASTA files.
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: 24, color: '#7c869e' }}>
          mycloove.com — no account needed
        </div>
      </div>
    ),
    { ...size },
  )
}
