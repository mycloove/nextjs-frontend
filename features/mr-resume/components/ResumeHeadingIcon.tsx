import type { ReactNode } from 'react'

export type ResumeHeadingIconId = 'none' | 'career' | 'education' | 'experience' | 'skills' | 'projects' | 'profile' | 'summary' | 'personal' | 'goal' | 'award'

export const resumeHeadingIconOptions: { id: Exclude<ResumeHeadingIconId, 'none'>; label: string; group: string; latex: string }[] = [
  { id: 'career', label: 'Career', group: 'Career', latex: '\\faChartLine' },
  { id: 'education', label: 'Education', group: 'Career', latex: '\\faGraduationCap' },
  { id: 'experience', label: 'Experience', group: 'Career', latex: '\\faBriefcase' },
  { id: 'skills', label: 'Skills', group: 'Career', latex: '\\faTools' },
  { id: 'projects', label: 'Projects', group: 'Career', latex: '\\faLayerGroup' },
  { id: 'profile', label: 'Profile', group: 'Profile', latex: '\\faAddressCard' },
  { id: 'summary', label: 'Summary', group: 'Profile', latex: '\\faAlignLeft' },
  { id: 'personal', label: 'Personal', group: 'Profile', latex: '\\faUser' },
  { id: 'goal', label: 'Goals', group: 'Profile', latex: '\\faBullseye' },
  { id: 'award', label: 'Awards', group: 'Profile', latex: '\\faAward' },
]

const iconPaths: Record<Exclude<ResumeHeadingIconId, 'none'>, ReactNode> = {
  career: <><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 6-7"/><path d="M16 6h4v4"/></>,
  education: <><path d="m2 9 10-5 10 5-10 5L2 9Z"/><path d="M6 11v5c3.5 2.7 8.5 2.7 12 0v-5M22 9v6"/></>,
  experience: <><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2"/></>,
  skills: <><path d="m14.5 6.5 3 3M4 20l5.5-1 9.9-9.9a2.1 2.1 0 0 0-3-3L6.5 16 4 20Z"/><path d="m13 8 3 3"/></>,
  projects: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
  profile: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2.5"/><path d="M5.5 17a3.5 3.5 0 0 1 7 0M15 9h3M15 13h3M15 17h3"/></>,
  summary: <><path d="M4 5h16M4 10h16M4 15h10M4 20h7"/><circle cx="19" cy="17" r="3"/></>,
  personal: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  goal: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
  award: <><circle cx="12" cy="8" r="5"/><path d="m8.5 12-1 9 4.5-2.5 4.5 2.5-1-9M10 8l1.3 1.3L14 7"/></>,
}

export function ResumeHeadingIcon({ name }: { name: ResumeHeadingIconId }) {
  if (name === 'none') return null
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>
}
