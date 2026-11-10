import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import MrResumeWorkspace from '@/features/mr-resume'

// The home (template gallery) is public and indexable; the two editor routes
// override this with noindex because they hold a person's private draft.
export const metadata: Metadata = {
  title: 'Mr. Resume \u2014 Resume, CV and biodata templates in Bangla and English',
  description: 'Choose a professional resume, CV, biodata or cover letter template and edit it visually or in LaTeX. Drafts stay on your device.',
  robots: { index: true, follow: true },
}

export default function MrResumeLayout({ children }: { children: ReactNode }) {
  // Keep drafts and pending copies in one host across the chooser and editor routes.
  return <><MrResumeWorkspace />{children}</>
}
