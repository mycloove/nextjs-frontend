import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import './theme.css'

const inter = Inter({ subsets: ['latin'] })

const extensionErrorGuard = `
(() => {
  const METAMASK_EXTENSION_ID = 'nkbihfbeogaeaoehlefnkodbefgpgknn'

  const getErrorText = (value) => {
    if (!value) return ''
    if (typeof value === 'string') return value

    const reason = value.reason || value.error || value
    const message = reason && typeof reason.message === 'string' ? reason.message : ''
    const stack = reason && typeof reason.stack === 'string' ? reason.stack : ''

    return message + '\\n' + stack
  }

  const isMetaMaskConnectionNoise = (value) => {
    const errorText = getErrorText(value)

    return (
      errorText.includes('Failed to connect to MetaMask') &&
      (
        errorText.includes('chrome-extension://' + METAMASK_EXTENSION_ID) ||
        errorText.includes('MetaMask')
      )
    )
  }

  window.addEventListener('unhandledrejection', (event) => {
    if (!isMetaMaskConnectionNoise(event.reason)) return

    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)

  window.addEventListener('error', (event) => {
    if (!isMetaMaskConnectionNoise(event.error || event.message)) return

    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)
})()
`

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mycloove.com'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'mycloove — Calm document tools',
    template: '%s | mycloove',
  },
  description: 'Convert, extract, edit, and understand PDF, Word, image, Markdown, and FASTA files with focused document tools.',
  applicationName: 'mycloove',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'mycloove',
    title: 'mycloove — Calm document tools',
    description: 'Convert, extract, edit, and understand PDF, Word, image, Markdown, and FASTA files — no account needed.',
    url: '/',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'mycloove — Calm document tools',
    description: 'Convert, extract, edit, and understand PDF, Word, image, Markdown, and FASTA files — no account needed.',
  },
  robots: { index: true, follow: true },
}

const themeScript = `(() => { try { const saved = localStorage.getItem('smilepdf-theme'); const theme = saved === 'light' || saved === 'dark' ? saved : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; } catch { document.documentElement.dataset.theme = 'dark'; document.documentElement.style.colorScheme = 'dark'; } })();`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className={inter.className}>
        <Script
          id="extension-error-guard"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{ __html: extensionErrorGuard }}
        />
        {/* Main container */}
        <main 
          className="min-h-screen relative"
          style={{}}
        >
          {/* ✅ Content */}
          <div className="relative z-10">
            {children}
          </div>
        </main>
      </body>
    </html>
  )
}
