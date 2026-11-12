/**
 * Site header navigation rules — pure, so they are testable without a browser
 * (`siteNav.test.ts`, run by `npm run test:tool-kit`).
 *
 * The header has two kinds of index entry, because the content genuinely
 * does: an anchor ("/#tools") is a section of one page and earns an in-view
 * state; a path ("/pricing") is a route and earns a path state.
 */

export type SiteNavLink = { href: string; label: string }
/** An index entry that runs an in-page action instead of navigating (e.g. "Shortcuts"). */
export type SiteNavAction = { label: string; onClick: () => void }
export type SiteNavItem = SiteNavLink | SiteNavAction

export function isNavLink(item: SiteNavItem): item is SiteNavLink {
  return 'href' in item
}

/** True for a fragment on the current page ("#gallery"), which the header scrolls to itself. */
export function isSamePageAnchor(href: string): boolean {
  return href.startsWith('#') && href.length > 1
}

/*
  The global product index, shown on marketing routes. The editor
  applications own their working chrome and never render it; tool pages show
  their own context instead (see components/tools/ToolNavbar.tsx).
*/
export const GLOBAL_NAV: readonly SiteNavLink[] = [
  { href: '/#tools', label: 'Tools' },
  { href: '/pdf-editor', label: 'PDF Editor' },
  { href: '/image-editor', label: 'Image Editor' },
  { href: '/document-ai', label: 'Document AI' },
  { href: '/pricing', label: 'Pricing' },
]

/** The fragment id an anchor link points at, or null for a plain route. */
export function sectionId(href: string): string | null {
  const index = href.indexOf('#')
  return index === -1 ? null : href.slice(index + 1) || null
}

/** The page an anchor link lives on ("/#tools" → "/", "#gallery" → null = this page). */
function anchorPage(href: string): string | null {
  const index = href.indexOf('#')
  if (index <= 0) return null
  return href.slice(0, index)
}

export function anchorIds(items: readonly SiteNavItem[]): string[] {
  return items
    .filter(isNavLink)
    .map((link) => sectionId(link.href))
    .filter((id): id is string => Boolean(id))
}

/**
 * Is this link the reader's current place? Anchors: only on their own page,
 * and only while their section is the one in view. Routes: the path or any
 * path beneath it — never "/" alone, which would light up on every page.
 */
export function isCurrentLink(href: string, pathname: string, activeSection: string | null): boolean {
  const section = sectionId(href)
  if (section) {
    const page = anchorPage(href)
    return (page === null || page === pathname) && activeSection === section
  }
  if (!href.startsWith('/') || href === '/') return false
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** aria-current for a link: a place on the page vs. the page itself. */
export function currentKind(href: string): 'location' | 'page' {
  return sectionId(href) ? 'location' : 'page'
}

/**
 * Scroll-rule reading in [0, 1]. Pages with no real scroll distance (login)
 * hold at 0 instead of dividing by a near-zero distance and reading "full".
 */
export function scrollProgress(scrollY: number, scrollHeight: number, viewportHeight: number): number {
  const distance = scrollHeight - viewportHeight
  if (!(distance > 24)) return 0
  return Math.min(1, Math.max(0, scrollY / distance))
}
