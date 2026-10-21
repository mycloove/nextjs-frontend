import type { Metadata } from 'next'
import { IBM_Plex_Mono } from 'next/font/google'
import ContactUsClient from './ContactUsClient'

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--cu-font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  // `absolute` bypasses the root layout's "%s | mycloove" title template,
  // matching the About page's `About — mycloove` pattern.
  title: { absolute: 'Contact — mycloove' },
  description:
    'Talk to the mycloove team. Questions, feedback, or ideas — a real person reads every message.',
}

export default function ContactUsPage() {
  // IBM Plex Mono is a register decision for this page's console readouts
  // (it is not loaded anywhere else in the repo — Document AI loads its own
  // fonts separately). The variable mounts on the contact root only, so the
  // font stays module-local.
  return <ContactUsClient monoClass={plexMono.variable} />
}
