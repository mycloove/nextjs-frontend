import type { Metadata } from 'next'
import MrResumeStudio from '@/features/mr-resume'

export const metadata: Metadata = {
  title: 'Mr.Resume — Document Studio',
  description: 'Build a tailored resume, academic CV, biodata, or statement of purpose in a live document studio.',
  robots: { index: false, follow: false },
}

export default function MrResumePage() {
  return <MrResumeStudio />
}
