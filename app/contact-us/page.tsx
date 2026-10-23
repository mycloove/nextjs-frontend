import type { Metadata } from 'next'
import { IBM_Plex_Mono, Space_Grotesk } from 'next/font/google'
import ContactUsClient from './ContactUsClient'

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--cu-font-mono',
  display: 'swap',
})

// Keep the marketing family's joined, geometric display voice reliable without
// activating shared chrome's Syne rules. Only this page consumes the variable.
const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--cu-font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { absolute: 'Contact | mycloove' },
  description:
    'A stuck file, a new idea, or a useful observation. Write to mycloove with a considered space for your message, in English or Bangla.',
}

export default function ContactUsPage() {
  // Both faces are self-hosted and applied only inside the contact root.
  return <ContactUsClient fontClass={`${plexMono.variable} ${display.variable}`} />
}
