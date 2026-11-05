import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import MrResumeWorkspace from '@/features/mr-resume'

export const metadata: Metadata = {
  title: 'Mr.Resume \u2014 Document Studio',
  description: 'Build a tailored resume, academic CV, biodata, or statement of purpose in a live document studio.',
  robots: { index: false, follow: false },
}

export default function MrResumeLayout({ children }: { children: ReactNode }) {
  // Keep drafts and pending copies in one host across the chooser and editor routes.
  return <><MrResumeWorkspace />{children}</>
}
