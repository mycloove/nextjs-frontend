'use client'

import Link from 'next/link'
import { PaneHead } from './parts'

const LINKS: { href: string; label: string; hint: string }[] = [
  { href: '/', label: 'SmilePDF home', hint: 'All tools' },
  { href: '/about-us', label: 'About', hint: 'Who builds this' },
  { href: '/privacy', label: 'Privacy', hint: 'How files are handled' },
  { href: '/terms', label: 'Terms', hint: 'The agreement' },
]

/**
 * About — what this bench is and where to find the rest of the product. No
 * build number is shown because the app does not stamp one; inventing a version
 * string would be a small lie, and the no-lie rule is a UI rule too.
 */
export default function AboutSection() {
  return (
    <section className="mr-cfg-section">
      <PaneHead eyebrow="Workspace" title="About" hint="Mr. Markdown is the document workbench of SmilePDF." />

      <div className="mr-cfg-about">
        <p>
          Mr. Markdown turns PDFs into clean, structured Markdown you can keep editing — with
          diagrams, tables and Bengali (Bijoy → Unicode) support built in. Your session lives in
          this browser; conversions run through the SmilePDF document service.
        </p>
      </div>

      <div className="mr-cfg-group">
        <span className="mr-cfg-group-label">Elsewhere</span>
        <ul className="mr-cfg-links">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="mr-cfg-link">
                <span className="mr-cfg-link-label">{link.label}</span>
                <span className="mr-cfg-link-hint">{link.hint}</span>
                <span className="mr-cfg-link-arrow" aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
