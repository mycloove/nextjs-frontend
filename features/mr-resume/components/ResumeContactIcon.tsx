import type { ReactNode } from 'react'
import type { ContactIconId } from './resumeEntries'

// Paper-resident glyphs for the contact row and entry metadata. Hand-set
// 24-grid path set in the heading-icon register (ResumeHeadingIcon) so the
// document never mixes two drawing systems.
export type ResumeContactIconName = ContactIconId | 'external'

const iconPaths: Record<ResumeContactIconName, ReactNode> = {
  email: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="m3.5 6.5 8.5 6 8.5-6" /></>,
  phone: <path d="M5.5 3.5h4l1.5 5-2.3 1.6a13 13 0 0 0 5.2 5.2L15.5 13l5 1.5v4a1.8 1.8 0 0 1-2 1.8A16.5 16.5 0 0 1 3.7 5.5a1.8 1.8 0 0 1 1.8-2Z" />,
  linkedin: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7.5 10.5v6.5M7.5 7.6v.1M11.5 17v-4a2.6 2.6 0 0 1 5.2 0v4" /></>,
  github: <path d="M12 2.5a9.5 9.5 0 0 0-3 18.5c.5.1.7-.2.7-.5v-1.7c-2.7.6-3.3-1.2-3.3-1.2-.4-1-1-1.3-1-1.3-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.7.4-1.1.6-1.3-2.1-.2-4.4-1-4.4-4.6a3.6 3.6 0 0 1 1-2.5 3.3 3.3 0 0 1 .1-2.5s.8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1a3.3 3.3 0 0 1 .1 2.5 3.6 3.6 0 0 1 1 2.5c0 3.6-2.3 4.4-4.4 4.6.3.3.6 1 .6 2v2.2c0 .3.2.6.7.5a9.5 9.5 0 0 0-3-18.5Z" />,
  globe: <><circle cx="12" cy="12" r="9.2" /><path d="M3 12h18M12 2.8c2.6 2.5 3.9 5.8 3.9 9.2s-1.3 6.7-3.9 9.2c-2.6-2.5-3.9-5.8-3.9-9.2s1.3-6.7 3.9-9.2Z" /></>,
  external: <><path d="M13 6H8a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h7a3 3 0 0 0 3-3v-5" /><path d="M14.5 3H21v6.5" /><path d="M21 3l-8.5 8.5" /></>,
}

export function ResumeContactIcon({ name, className }: { name: ResumeContactIconName; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>
}
