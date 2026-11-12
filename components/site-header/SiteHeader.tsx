'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import AnimatedBrandLogo from '@/components/animated-brand-logo/AnimatedBrandLogo'
import AuthNavButton from '@/components/AuthNavButton'
import MyclooveWordmark from '@/components/brand/mycloove/MyclooveWordmark'
import type { AccountViewerState } from '@/lib/account/useAccountViewer'
import type { CreditBalanceState } from '@/lib/usage/credit-types'
import {
  anchorIds,
  currentKind,
  isCurrentLink,
  isNavLink,
  isSamePageAnchor,
  scrollProgress,
  sectionId,
  type SiteNavItem,
  type SiteNavLink,
} from './siteNav'
import styles from './SiteHeader.module.css'

export type SiteHeaderProps = {
  /** One resolver per page: the same state feeds the desktop and sheet account controls. */
  accountState: AccountViewerState
  creditState: CreditBalanceState
  /** The page's index. Marketing passes the global five; an entry page passes its own sections. */
  links?: readonly SiteNavItem[]
  navLabel?: string
  /** Where the reader is: shown after the lockup as a breadcrumb (tool and entry pages). */
  context?: { group?: string | null; current: string }
  /** The bar's one filled action. Omitted on pages whose own surface carries the verb. */
  primaryAction?: { label: string; onClick?: () => void; href?: string }
  /** The page's own controls, left of the account register (credit readout, tool index). */
  extras?: ReactNode
  /** Move `extras` into the sheet on narrow screens (pass the sheet's copy as `sheetExtras`). */
  collapseExtras?: boolean
  /** Page controls shown at the foot of the mobile sheet (e.g. a language switch). */
  sheetExtras?: ReactNode
  /** Destinations that only the mobile sheet lists (e.g. "All tools" on an entry page). */
  sheetLinks?: readonly SiteNavLink[]
  /** `tool` aligns the lockup with the tool workspace column. */
  frame?: 'site' | 'tool'
  /** Skip-link target; null when the page has no single content target. */
  skipTo?: string | null
  /** For pages that scroll inside an element rather than the window. */
  scrollContainer?: RefObject<HTMLElement | null>
  creditDisplayToolId?: string
  dockedCredit?: 'always' | 'narrow'
  sheetNote?: string | null
  /** Extra hooks a page needs on the bar (e.g. a verified contract class). */
  className?: string
  /** Stable selector for navigation verification (`data-tool-navbar`). */
  toolNavbarId?: string
}

const plusIcon = (size: number, strokeWidth: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

/**
 * The site header: one chassis for marketing pages, tool pages and editor
 * entry screens. Pages supply only what they need through slots — the bar's
 * design, motion and keyboard behaviour are the same everywhere. Editor
 * working panels (Mr. Markdown workspace, Mr. Resume editors, PDF Editor
 * canvas) never mount it; they own their chrome.
 */
export default function SiteHeader({
  accountState,
  creditState,
  links = [],
  navLabel = 'Primary navigation',
  context,
  primaryAction,
  extras,
  collapseExtras = false,
  sheetExtras,
  sheetLinks = [],
  frame = 'site',
  skipTo = '#main-content',
  scrollContainer,
  creditDisplayToolId,
  dockedCredit,
  sheetNote = null,
  className = '',
  toolNavbarId,
}: SiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const headerRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const primaryRef = useRef<HTMLElement | null>(null)
  const pathname = usePathname() ?? '/'
  const hasSheet = links.length > 0 || Boolean(primaryAction) || sheetLinks.length > 0 || Boolean(sheetExtras)
  const anchors = anchorIds(links).join('|')

  /*
    The bottom hairline is the page's scroll rule. Progress is written straight
    onto the node as a custom property — state would re-render the header on
    every scroll event; setScrolled only renders when the threshold flips.
  */
  useEffect(() => {
    const container = scrollContainer?.current ?? null
    let frame = 0
    const measure = () => {
      frame = 0
      const y = container ? container.scrollTop : window.scrollY
      setScrolled(y > 12)
      const node = headerRef.current
      if (!node) return
      const progress = container
        ? scrollProgress(y, container.scrollHeight, container.clientHeight)
        : scrollProgress(y, document.documentElement.scrollHeight, window.innerHeight)
      node.style.setProperty('--nav-progress', progress.toFixed(4))
    }
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }
    const target: HTMLElement | Window = container ?? window
    measure()
    target.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      target.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [scrollContainer])

  /* In-view state for anchor links. No-ops when no anchor target is on the page. */
  useEffect(() => {
    const ids = anchors ? anchors.split('|') : []
    if (!ids.length || typeof IntersectionObserver === 'undefined') return
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => Boolean(element))
    if (!sections.length) return

    const ratios = new Map<string, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => ratios.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0))
        let best = ''
        let bestRatio = 0
        ratios.forEach((ratio, id) => {
          if (ratio > bestRatio) {
            bestRatio = ratio
            best = id
          }
        })
        setActiveSection(best || null)
      },
      // Biased to the upper band, under the bar's own 72px.
      { rootMargin: '-72px 0px -45% 0px', threshold: [0, 0.1, 0.25, 0.5, 0.75] },
    )
    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [anchors, pathname])

  useEffect(() => {
    if (!menuOpen) return
    const closeMenu = (event: KeyboardEvent | PointerEvent) => {
      // Account dialogs portal outside the bar but are still this layer.
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[data-account-surface]'))) return
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') {
          setMenuOpen(false)
          menuButtonRef.current?.focus()
        }
        return
      }
      if (!headerRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('keydown', closeMenu)
    document.addEventListener('pointerdown', closeMenu)
    return () => {
      document.removeEventListener('keydown', closeMenu)
      document.removeEventListener('pointerdown', closeMenu)
    }
  }, [menuOpen])

  /*
    Magnetic + specular primary: the one filled control tracks the pointer by a
    capped offset and lights a sheen where it sits. Custom properties only;
    reduced motion and coarse pointers bypass it entirely.
  */
  useEffect(() => {
    const node = primaryRef.current
    if (!node) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)')
    let frameId = 0
    let active = false
    const current = { x: 0, y: 0 }
    const target = { x: 0, y: 0 }

    const render = () => {
      current.x += (target.x - current.x) * 0.18
      current.y += (target.y - current.y) * 0.18
      node.style.setProperty('--tb-x', `${current.x.toFixed(2)}px`)
      node.style.setProperty('--tb-y', `${current.y.toFixed(2)}px`)
      const settled = Math.abs(target.x - current.x) < 0.05 && Math.abs(target.y - current.y) < 0.05
      frameId = active || !settled ? requestAnimationFrame(render) : 0
    }
    const start = () => {
      if (!frameId) frameId = requestAnimationFrame(render)
    }
    const onMove = (event: PointerEvent) => {
      if (reduceMotion.matches || !finePointer.matches) return
      const bounds = node.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      const cap = 3
      target.x = Math.max(-cap, Math.min(cap, (event.clientX - (bounds.left + bounds.width / 2)) * 0.16))
      target.y = Math.max(-cap, Math.min(cap, (event.clientY - (bounds.top + bounds.height / 2)) * 0.16))
      node.style.setProperty('--tb-px', `${(((event.clientX - bounds.left) / bounds.width) * 100).toFixed(1)}%`)
      node.style.setProperty('--tb-py', `${(((event.clientY - bounds.top) / bounds.height) * 100).toFixed(1)}%`)
      active = true
      start()
    }
    const reset = () => {
      active = false
      target.x = 0
      target.y = 0
      start()
    }
    node.addEventListener('pointermove', onMove)
    node.addEventListener('pointerleave', reset)
    node.addEventListener('pointercancel', reset)
    return () => {
      if (frameId) cancelAnimationFrame(frameId)
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerleave', reset)
      node.removeEventListener('pointercancel', reset)
    }
  }, [primaryAction?.label])

  const isCurrent = (href: string) => isCurrentLink(href, pathname, activeSection)

  /* Same-page anchors scroll here, in whatever element scrolls the page, and
     honour reduced motion; the URL keeps the fragment for sharing. */
  const followAnchor = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    const target = document.getElementById(href.slice(1))
    setMenuOpen(false)
    if (!target) return
    event.preventDefault()
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
    window.history.replaceState(window.history.state, '', href)
  }

  /** One index entry, in the bar or in the sheet. */
  const renderItem = (item: SiteNavItem, inSheet: boolean, index: number) => {
    const sheetProps = inSheet
      ? { tabIndex: menuOpen ? 0 : -1, style: { animationDelay: menuOpen ? `${index * 45}ms` : '0ms' } }
      : {}
    if (!isNavLink(item)) {
      return (
        <button
          key={`action-${item.label}`}
          type="button"
          {...sheetProps}
          onClick={() => {
            setMenuOpen(false)
            item.onClick()
          }}
        >
          <span>{item.label}</span>
        </button>
      )
    }
    const current = isCurrent(item.href)
    const common = {
      className: current ? styles.active : undefined,
      'aria-current': current ? currentKind(item.href) : undefined,
      ...sheetProps,
    }
    // Only entries that leave the page get the sheet's chevron.
    const chevron = inSheet && !sectionId(item.href) ? (
      <svg className={styles.sheetChevron} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m9 18 6-6-6-6" />
      </svg>
    ) : null
    if (isSamePageAnchor(item.href)) {
      return (
        <a key={item.href} href={item.href} {...common} onClick={(event) => followAnchor(event, item.href)}>
          <span>{item.label}</span>
          {chevron}
        </a>
      )
    }
    return (
      <Link key={item.href} href={item.href} {...common} onClick={() => setMenuOpen(false)}>
        <span>{item.label}</span>
        {chevron}
      </Link>
    )
  }

  const identity = (
    <>
      <Link href="/" className={styles.brand} aria-label="mycloove home">
        <AnimatedBrandLogo className={styles.logo} />
        <span className={styles.wordmark}><MyclooveWordmark accent="orange" /></span>
      </Link>
      {context && (
        <>
          {context.group && (
            <>
              <span className={`${styles.rule} ${styles.crumbStep}`} aria-hidden="true" />
              <span className={`${styles.crumbGroup} ${styles.crumbStep}`}>{context.group}</span>
            </>
          )}
          <span className={styles.rule} aria-hidden="true" />
          <span className={styles.crumbCurrent} title={context.current} aria-current="page">{context.current}</span>
        </>
      )}
    </>
  )

  const primaryContent = (size: number, stroke: number, labelClass?: string) => (
    <>
      {plusIcon(size, stroke)}
      <span className={labelClass}>{primaryAction?.label}</span>
    </>
  )

  return (
    <header
      ref={headerRef}
      className={[
        styles.header,
        frame === 'tool' ? styles.frameTool : '',
        context ? styles.withContext : '',
        context && links.length > 0 ? styles.dense : '',
        scrolled ? styles.scrolled : '',
        className,
      ].filter(Boolean).join(' ')}
      data-tool-navbar={toolNavbarId}
    >
      {skipTo && (
        <a className={styles.skip} href={skipTo}>
          Skip to content
        </a>
      )}
      <div className={styles.shell}>
        {context ? (
          <nav className={styles.identity} aria-label="Breadcrumb">{identity}</nav>
        ) : (
          <div className={styles.identity}>{identity}</div>
        )}

        {links.length > 0 && (
          <nav className={styles.nav} aria-label={navLabel}>
            {links.map((item, i) => renderItem(item, false, i))}
          </nav>
        )}

        <div className={styles.actions}>
          {extras && <div className={`${styles.extras}${collapseExtras ? ` ${styles.extrasCollapse}` : ''}`}>{extras}</div>}

          {primaryAction?.onClick ? (
            <button
              type="button"
              className={styles.primary}
              ref={(node) => { primaryRef.current = node }}
              onClick={primaryAction.onClick}
            >
              {primaryContent(14, 2.4, styles.primaryLabel)}
            </button>
          ) : primaryAction?.href ? (
            <Link
              href={primaryAction.href}
              className={styles.primary}
              ref={(node) => { primaryRef.current = node }}
            >
              {primaryContent(14, 2.4, styles.primaryLabel)}
            </Link>
          ) : null}

          <div className={styles.utility}>
            <AuthNavButton
              chrome={frame === 'tool' ? 'tool' : 'home'}
              accountState={accountState}
              creditState={creditState}
              creditDisplayToolId={creditDisplayToolId}
              dockedCredit={dockedCredit}
            />
          </div>

          {hasSheet && (
            <button
              type="button"
              ref={menuButtonRef}
              className={`${styles.menuButton}${menuOpen ? ` ${styles.menuOpen}` : ''}`}
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="site-header-sheet"
              aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            >
              <span />
              <span />
              <span />
            </button>
          )}
        </div>
      </div>

      {hasSheet && (
        <div id="site-header-sheet" className={`${styles.sheet}${menuOpen ? ` ${styles.sheetOpen}` : ''}`} aria-hidden={!menuOpen}>
          {(links.length > 0 || sheetLinks.length > 0) && (
            <nav className={styles.sheetNav} aria-label="Mobile navigation">
              {[...links, ...sheetLinks].map((item, i) => renderItem(item, true, i))}
            </nav>
          )}
          {primaryAction?.onClick ? (
            <button
              type="button"
              className={styles.sheetPrimary}
              tabIndex={menuOpen ? 0 : -1}
              onClick={() => {
                setMenuOpen(false)
                primaryAction.onClick?.()
              }}
            >
              {primaryContent(16, 2.3)}
            </button>
          ) : primaryAction?.href ? (
            <Link href={primaryAction.href} className={styles.sheetPrimary} tabIndex={menuOpen ? 0 : -1} onClick={() => setMenuOpen(false)}>
              {primaryContent(16, 2.3)}
            </Link>
          ) : null}
          {sheetExtras && <div className={styles.sheetExtras}>{sheetExtras}</div>}
          {menuOpen ? (
            <AuthNavButton
              variant="mobile"
              chrome={frame === 'tool' ? 'tool' : 'home'}
              accountState={accountState}
              creditState={creditState}
              creditDisplayToolId={creditDisplayToolId}
              onNavigate={() => setMenuOpen(false)}
            />
          ) : null}
          {sheetNote && <p className={styles.sheetNote}>{sheetNote}</p>}
        </div>
      )}
    </header>
  )
}
