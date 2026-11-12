'use client'

import type { RefObject } from 'react'
import SiteHeader from '@/components/site-header/SiteHeader'
import { useAccountViewer } from '@/lib/account/useAccountViewer'
import { useCreditBalance } from '@/lib/usage/useCreditBalance'
import { homeText, pick, type HomeLanguage } from './homeText'
import styles from './ResumeHome.module.css'

const anchors = [
  { id: 'templates', label: homeText.navTemplates },
  { id: 'compare', label: homeText.navCompare },
  { id: 'import', label: homeText.navImport },
] as const

/* The Mr. Resume entry bar: the site header every non-editor page shares,
   with this page's own context (Workspaces › Mr. Resume), its three sections
   and the EN / বাংলা switch. Theme lives in the account Settings, as on every
   other page. The editors (/mr-resume/regular-editor, /mr-resume/latex) keep
   their own working chrome and never mount this. Mr. Resume is not in the
   shared tool registry, so there is no tool index here (plan D-1). */
export default function ResumeHomeNavbar({ language, onLanguage, scroller }: { language: HomeLanguage; onLanguage: (language: HomeLanguage) => void; scroller: RefObject<HTMLDivElement | null> }) {
  const accountState = useAccountViewer()
  const creditState = useCreditBalance(accountState.status === 'loading' ? null : accountState.viewer?.id ?? 'guest')
  const t = <T,>(value: { en: T; bn: T }) => pick(value, language)

  const languageSwitch = <div className={styles.languageSwitch} role="group" aria-label={t(homeText.language)}>
    {(['en', 'bn'] as const).map((item) => <button key={item} type="button" aria-pressed={language === item} lang={item} onClick={() => onLanguage(item)}>{item === 'en' ? 'EN' : 'বাংলা'}</button>)}
  </div>

  return (
    <SiteHeader
      accountState={accountState}
      creditState={creditState}
      context={{ group: t(homeText.workspaces), current: t(homeText.product) }}
      links={anchors.map((anchor) => ({ href: `#${anchor.id}`, label: t(anchor.label) }))}
      navLabel={t(homeText.menu)}
      sheetLinks={[{ href: '/', label: t(homeText.allTools) }]}
      extras={languageSwitch}
      collapseExtras
      sheetExtras={languageSwitch}
      /* The page keeps its own localized skip link (ResumeHome). */
      skipTo={null}
      scrollContainer={scroller}
    />
  )
}
