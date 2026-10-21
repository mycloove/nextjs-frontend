import { Fraunces, JetBrains_Mono } from 'next/font/google'

/**
 * The studio's two voice faces, loaded with `next/font` so they are
 * self-hosted and preloaded (no render-blocking CDN @import).
 *
 * — Fraunces: panel titles and the empty-state headline. The design's
 *   editorial character comes from a serif display face; the app's own
 *   heading stack (Syne/DM Sans) stays untouched everywhere else.
 * — JetBrains Mono: every micro-label, filename, count and dimension. The
 *   workbench reads as instrumentation because the numbers are monospaced.
 *
 * Exposed as CSS variables so the stylesheet owns the fallback chain:

 *   --am-serif: var(--am-font-serif), Georgia, serif
 *   --am-mono:  var(--am-font-mono), ui-monospace, monospace
 */
export const studioSerif = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--am-font-serif',
  display: 'swap',
})

export const studioMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--am-font-mono',
  display: 'swap',
})
