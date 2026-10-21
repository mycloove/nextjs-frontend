import { adminEntryRedirect, requireAdmin } from '@/lib/usage/admin'
import { JetBrains_Mono } from 'next/font/google'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import AdminFrame from './AdminFrame'

/* The bench is private: keep it out of search indexes entirely. Page-level
   titles still apply; this layout only supplies the robots directive. */
export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
}

/*
 * JetBrains Mono is loaded here, scoped to /admin through a CSS variable, the
 * same way the Split and Mr. Markdown pages load their own identity fonts.
 * app/layout.tsx only exposes Inter on <body> as a next/font class, so there is
 * no inherited mono cut — and this surface is mostly numbers (caps, counts,
 * windows, ids), which is exactly the content that must not fall back to
 * whatever the operating system supplies and end up with ragged digits.
 */
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
})

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const gate = await requireAdmin()
  const entry = adminEntryRedirect(gate)
  if (entry) redirect(entry)

  /*
   * `user` only exists on the open gate. When the store is missing the gate is
   * 503 and the bench still renders — the pages show a degraded banner instead —
   * so the spine falls back to a neutral identity rather than crashing on it.
   */
  const email = gate.ok ? (gate.user.email ?? null) : null

  return (
    <div className={jetbrainsMono.variable}>
      <AdminFrame email={email} role={gate.ok ? gate.role : null}>{children}</AdminFrame>
    </div>
  )
}
