import type { Metadata } from 'next'
import { IBM_Plex_Mono } from 'next/font/google'

import AboutUsClient from './AboutUsClient'

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--au-font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { absolute: 'About — mycloove' },
  description:
    'mycloove builds precise, private document tools — designed with the care of a workshop, not the noise of a marketplace.',
}

export default function AboutUsPage() {
  // IBM Plex Mono is a register decision for this page's readouts/index
  // (module-local: the variable mounts on the about root only).
  return <AboutUsClient monoClass={plexMono.variable} />
}
