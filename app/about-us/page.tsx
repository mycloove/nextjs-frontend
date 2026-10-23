import { IBM_Plex_Mono, Space_Grotesk } from 'next/font/google'
import { pageMetadata } from '@/lib/metadata'

import AboutUsClient from './AboutUsClient'

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--au-font-mono',
  display: 'swap',
})

// A folio-specific geometric display: the open, joined forms echo the brand
// clasp. A distinct family also avoids activating shared chrome's Syne styles.
const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--myc-font-display',
  display: 'swap',
})

export const metadata = pageMetadata(
  '/about-us',
  'About',
  'A file is only the beginning. Meet mycloove: thoughtful tools to convert, recover, edit, and understand your documents, with Bangla built into the collection.',
)

export default function AboutUsPage() {
  // Route-scoped self-hosting keeps the folio and display typography reliable
  // even when the global third-party font import is unavailable.
  return <AboutUsClient fontClass={`${plexMono.variable} ${display.variable}`} />
}
