'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import Link from 'next/link'
import AnimatedBrandLogo from '@/components/animated-brand-logo/AnimatedBrandLogo'
import MyclooveWordmark from '@/components/brand/mycloove/MyclooveWordmark'
import AuthNavButton from '@/components/AuthNavButton'
import ThemeToggle from '@/components/ThemeToggle'
import { homeText, pick, type HomeLanguage } from './homeText'
import { HomeIcon } from './homeIcons'
import styles from './ResumeHome.module.css'

const anchors = [
  { id: 'templates', label: homeText.navTemplates },
  { id: 'compare', label: homeText.navCompare },
  { id: 'import', label: homeText.navImport },
] as const

/* The Mr. Resume chassis: breadcrumb identity (mycloove / Workspaces / Mr. Resume),
   in-page sections, the shared theme and account controls. Built from shared
   pieces the way the other full-screen tools do, without the tool switcher —
   Mr. Resume is not in the shared navigation registry (see the plan, D-1). */
export default function ResumeHomeNavbar({ language, onLanguage, scroller }: { language: HomeLanguage; onLanguage: (language: HomeLanguage) => void; scroller: RefObject<HTMLDivElement | null> }) {
  const [current, setCurrent] = useState<string | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const menu = useRef<HTMLDialogElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const t = <T,>(value: { en: T; bn: T }) => pick(value, language)

  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const onScroll = () => setScrolled(root.scrollTop > 4)
    root.addEventListener('scroll', onScroll, { passive: true })
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (visible) setCurrent(visible.target.id)
    }, { root, rootMargin: '-30% 0px -60% 0px' })
    for (const anchor of anchors) { const element = document.getElementById(anchor.id); if (element) observer.observe(element) }
    return () => { root.removeEventListener('scroll', onScroll); observer.disconnect() }
  }, [scroller])

  function jump(id: string) {
    menu.current?.close()
    document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }

  const languageSwitch = <div className={styles.languageSwitch} role="group" aria-label={t(homeText.language)}>
    {(['en', 'bn'] as const).map((item) => <button key={item} type="button" aria-pressed={language === item} lang={item} onClick={() => onLanguage(item)}>{item === 'en' ? 'EN' : 'বাংলা'}</button>)}
  </div>

  return <header className={styles.navbar} data-scrolled={scrolled || undefined}>
    <div className={styles.navInner}>
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link href="/" className={styles.brand} aria-label={t(homeText.home)}>
          <AnimatedBrandLogo />
          <span className={styles.wordmark}><MyclooveWordmark tone="auto" accent="orange" /></span>
        </Link>
        <span className={styles.crumbRule} aria-hidden="true" />
        <span className={styles.crumbGroup}>{t(homeText.workspaces)}</span>
        <span className={styles.crumbRule} aria-hidden="true" />
        <span className={styles.crumbCurrent} aria-current="page"><HomeIcon name="page" />{t(homeText.product)}</span>
      </nav>
      <nav className={styles.anchors} aria-label={t(homeText.menu)}>
        {anchors.map((anchor) => <a key={anchor.id} href={`#${anchor.id}`} aria-current={current === anchor.id ? 'location' : undefined} onClick={(event) => { event.preventDefault(); jump(anchor.id) }}>{t(anchor.label)}</a>)}
      </nav>
      <div className={styles.navControls}>
        <span className={styles.desktopOnly}>{languageSwitch}</span>
        <ThemeToggle />
        <AuthNavButton chrome="tool" />
        <button ref={menuButton} type="button" className={styles.menuButton} aria-label={t(homeText.menu)} aria-haspopup="dialog" onClick={() => menu.current?.showModal()}><HomeIcon name="menu" /></button>
      </div>
    </div>
    <dialog ref={menu} className={styles.menuSheet} aria-label={t(homeText.menu)} onClose={() => menuButton.current?.focus()} onClick={(event) => { if (event.target === menu.current) menu.current?.close() }}>
      <div className={styles.menuHead}><b>{t(homeText.product)}</b><button type="button" className={styles.iconButton} aria-label={t(homeText.closeMenu)} onClick={() => menu.current?.close()}><HomeIcon name="close" /></button></div>
      <ul>{anchors.map((anchor) => <li key={anchor.id}><a href={`#${anchor.id}`} onClick={(event) => { event.preventDefault(); jump(anchor.id) }}>{t(anchor.label)}<HomeIcon name="next" /></a></li>)}<li><Link href="/">{t(homeText.allTools)}<HomeIcon name="next" /></Link></li></ul>
      {languageSwitch}
    </dialog>
  </header>
}
