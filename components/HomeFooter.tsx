'use client'

import Link from 'next/link'

import AnimatedBrandLogo from '@/components/animated-brand-logo/AnimatedBrandLogo'
import MyclooveWordmark from '@/components/brand/mycloove/MyclooveWordmark'
import { toolIdForHref } from '@/lib/usage/catalog'
import { useToolAvailability } from '@/lib/usage/useToolAvailability'

const footerGroups = [
  {
    title: 'Convert',
    links: [
      { label: 'Images to PDF', href: '/image-to-pdf' },
      { label: 'PDF to Images', href: '/pdf-to-images' },
      { label: 'PDF to Word', href: '/pdf-to-word' },
      { label: 'Word to PDF', href: '/word-to-pdf' },
    ],
  },
  {
    title: 'Intelligence',
    links: [
      { label: 'AI Analyzer', href: '/ai-analyzer' },
      { label: 'Image to Text', href: '/image-to-text' },
      { label: 'Mr. Markdown', href: '/mr-markdown' },
      { label: 'Batch Process', href: '/batch-process' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About us', href: '/about-us' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'FAQ', href: '/faq' },
      { label: 'Contact', href: '/contact-us' },
      { label: 'Security', href: '/#security' },
      { label: 'Terms', href: '/terms' },
      { label: 'Privacy', href: '/privacy' },
      { label: 'All tools', href: '/#tools' },
    ],
  },
]

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

export default function HomeFooter() {
  const { enabled } = useToolAvailability()

  /*
    The orange brand-orangev2 lockup is the product identity on every route
    this footer mounts on — the same mark the topbar now uses, so no page can
    show mismatched brand colours between its header and footer.
  */

  const groups = footerGroups.map((group) => ({
    ...group,
    links: group.links.filter((link) => {
      const toolId = toolIdForHref(link.href)
      return !toolId || enabled(toolId)
    }),
  })).filter((group) => group.links.length > 0)
  return (
    <footer className="home-footer">
      <div className="home-footer-glow" aria-hidden="true" />
      <div className="home-footer-shell">
        <section className="home-footer-cta" aria-labelledby="footer-cta-title">
          <div className="home-footer-cta-copy">
            <span className="home-footer-eyebrow"><span /> Your document workspace</span>
            <h2 id="footer-cta-title">One less thing to worry about.</h2>
            <p>Open a file, choose what you need, and keep moving. No setup, no learning curve.</p>
          </div>
          <div className="home-footer-cta-actions">
            <Link className="home-footer-primary" href="/#heroFile">
              Open a file
              <ArrowIcon />
            </Link>
            <Link className="home-footer-secondary" href="/#tools">Explore every tool</Link>
          </div>
        </section>

        <div className="home-footer-main">
          <div className="home-footer-brand-column">
            <Link
              href="/"
              className="home-footer-brand"
              aria-label="mycloove home"
            >
              <AnimatedBrandLogo src="/animated-brand-logo-orange.png" />
              {/*
                Same lockup as the topbar: [octopus] / mycloove. The footer is the
                one always-dark surface on the home page (its #101713 background
                has no light-theme override), so the wordmark renders the dark
                twin for contrast with the orange bead pair. The link's
                aria-label carries the accessible name.
              */}
              <MyclooveWordmark tone="dark" accent="orange" />
            </Link>
            <p>Fast, thoughtful document tools for the work that matters.</p>
            <div className="home-footer-trust"><ShieldIcon /><span>Private by design</span></div>
          </div>

          <nav className="home-footer-links" aria-label="Footer navigation">
            {groups.map((group) => (
              <div className="home-footer-group" key={group.title}>
                <h3>{group.title}</h3>
                {group.links.map((link) => <Link key={link.href + link.label} href={link.href}>{link.label}</Link>)}
              </div>
            ))}
          </nav>
        </div>

        <div className="home-footer-bottom">
          <p>© {new Date().getFullYear()} Mycloove. Made for focused work.</p>
          <div>
            <Link href="/contact-us">Report an issue</Link>
            <span>English</span>
          </div>
        </div>
      </div>
    </footer>
  )
}