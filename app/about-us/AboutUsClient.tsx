'use client'

/*
  About — "The Workshop Atlas".

  Instrument concept: the front hall of the workshop — an atlas of the real
  instruments you can walk through. The keeper's Armature Dial is the page's
  one signature moment, upgraded into a guided tour: it walks the real tools
  by itself (an auto-tour tick every 2.2s), stops the instant the visitor
  takes over (hover, focus, click or arrow keys), and every selection is
  real data — the same ledger the section below reads. The tour label says
  which mode you are in, because honesty is the house standard.

  Interaction contract: roving tabindex across the 18 instrument arcs
  (arrow keys move, Enter opens), each readout crossfades on change, and
  under prefers-reduced-motion the tour never starts and nothing moves.

  Palette: the marketing surface (app/home.css, both themes) plus the
  mycloove blue accent shared with Pricing/Contact (#0b5ca8 light /
  #5b8def dark). Blue is identity/action only. The octopus mark is the
  canonical AnimatedBrandLogo, reused unchanged; its "gaze" is a transform
  on this page's wrapper. Console readouts use IBM Plex Mono, loaded
  module-locally in page.tsx.
  Blueprint floor: the family's shared ground (About/Pricing/Contact).
*/

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import Link from 'next/link'

import AnimatedBrandLogo from '@/components/animated-brand-logo/AnimatedBrandLogo'
import HomeFooter from '@/components/HomeFooter'
import Topbar2 from '@/components/Topbar2'
import LayeredIcon, { type LayeredIconVariant } from '@/components/tools/layered-icons/LayeredIcon'
import { toolIdForHref } from '@/lib/usage/catalog'
import { useToolAvailability } from '@/lib/usage/useToolAvailability'

import styles from './AboutUs.module.css'

import '../home.css'

type ToolGroup = 'Convert' | 'Extract' | 'Edit' | 'Ask AI' | 'Advanced'

type AboutTool = {
  href: string
  /* Sixteen of the eighteen tools wear the shared layered icon; the two
     newest workspaces have no variant yet, so they carry a plain stroke
     glyph and share the same slot instead (see `glyphSlot` in the CSS). */
  variant?: LayeredIconVariant
  glyph?: ReactNode
  label: string
  desc: string
  group: ToolGroup
}

//── Stroke glyphs (1.8 stroke, currentColor — no emoji) ───────────────────────
const arrow = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="4" y1="12" x2="20" y2="12" />
    <polyline points="13 5 20 12 13 19" />
  </svg>
)
const glyph = {
  gauge: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 16a8 8 0 1 1 16 0" />
      <path d="M12 16l3.6-4.4" />
      <circle cx="12" cy="16" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  ),
  /* The first Bengali letter — the same mark the Bijoy tool's tile wears. */
  bangla: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="13" r="5.5" />
      <line x1="6.5" y1="13" x2="17.5" y2="13" />
      <line x1="9" y1="4" x2="15" y2="4" />
    </svg>
  ),
  lock: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  check: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="16 8.5 10.2 14.5 8 12.2" />
    </svg>
  ),
  shield: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  star: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3z" />
    </svg>
  ),
  /* For the two tools without a layered variant (Document AI, the Image Editor). */
  sparkles: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
    </svg>
  ),
  crop: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </svg>
  ),
}

//── The instruments (routes + labels mirror the home page's tool set) ─────────
const tools: AboutTool[] = [
  { href: '/image-to-pdf', variant: 'image-to-pdf', label: 'Images to PDF', desc: 'Combine multiple images into one clean, shareable PDF.', group: 'Convert' },
  { href: '/pdf-to-images', variant: 'pdf-to-images', label: 'PDF to Images', desc: 'Export every PDF page as a crisp, high-quality image.', group: 'Convert' },
  { href: '/pdf-to-word', variant: 'pdf-to-word', label: 'PDF to Word', desc: 'Turn a PDF into an editable DOCX while keeping it readable.', group: 'Convert' },
  { href: '/word-to-pdf', variant: 'word-to-pdf', label: 'Word to PDF', desc: 'Create a polished PDF from a Word document in seconds.', group: 'Convert' },
  { href: '/mr-markdown', variant: 'pdf-to-markdown', label: 'Mr. Markdown', desc: 'Convert PDFs to Markdown, then edit and export in one workspace.', group: 'Convert' },
  { href: '/markdown-to-pdf', variant: 'markdown-to-pdf', label: 'Markdown to PDF', desc: 'Publish readable PDFs with native Bangla font support.', group: 'Convert' },
  { href: '/merge-pdf', variant: 'merge-pdf', label: 'Merge PDF', desc: 'Combine multiple PDFs into one clean document.', group: 'Convert' },
  { href: '/split-pdf', variant: 'split-pdf', label: 'Split PDF', desc: 'Cut one PDF into parts by page ranges.', group: 'Convert' },
  { href: '/rotate-pdf', variant: 'rotate-pdf', label: 'Rotate PDF', desc: 'Turn every page — or a range — by 90°, 180°, or 270°.', group: 'Convert' },
  { href: '/compress-pdf', variant: 'compress-pdf', label: 'Compress PDF', desc: 'Shrink PDF file size structurally, text stays selectable.', group: 'Convert' },
  { href: '/image-to-text', variant: 'image-to-text', label: 'Image to Text', desc: 'Extract reusable text from photos, screenshots, and scans.', group: 'Extract' },
  { href: '/bijoy-converter', variant: 'bijoy-converter', label: 'Bijoy to Unicode', desc: 'Convert legacy Bijoy-encoded Bangla into clean, searchable Unicode.', group: 'Extract' },
  { href: '/pdf-editor', variant: 'pdf-editor', label: 'PDF Editor', desc: 'Change the text that is actually in the file, then export those bytes.', group: 'Edit' },
  { href: '/image-editor', glyph: glyph.crop, label: 'Image Editor', desc: 'Crop, resize, and compress an image on the canvas before you export it.', group: 'Edit' },
  { href: '/ai-analyzer', variant: 'ai-analyzer', label: 'AI Analyzer', desc: 'Ask questions, summarize documents, and uncover key insights.', group: 'Ask AI' },
  { href: '/document-ai', glyph: glyph.sparkles, label: 'Document AI', desc: 'Ask a document questions and keep the answers beside the pages.', group: 'Ask AI' },
  { href: '/batch-process', variant: 'batch', label: 'Batch Process', desc: 'Run one repeatable workflow across multiple files at once.', group: 'Advanced' },
  { href: '/fasta-tools', variant: 'fasta-tool', label: 'FASTA Tools', desc: 'Inspect and work with biological sequences in one workspace.', group: 'Advanced' },
]

const GROUP_ORDER: ToolGroup[] = ['Convert', 'Extract', 'Edit', 'Ask AI', 'Advanced']

const principles = [
  { icon: glyph.gauge, title: 'The meter stays on the wall', desc: 'Every tool shows its live count before you start — the same number it enforces. No surprises at the end.' },
  { icon: glyph.bangla, title: 'Bangla is first-class', desc: 'Bangla documents and legacy Bijoy text run through purpose-built tools with native fonts — built in from the start.' },
  { icon: glyph.lock, title: 'Private by default', desc: 'Files are never stored — processed then deleted.' },
  { icon: glyph.shield, title: 'No account needed', desc: 'SSL encrypted. Use every tool without signing up.' },
  { icon: glyph.check, title: 'Free to use', desc: 'Every tool is free within a fair-use limit. No card required.' },
]

//── Armature Dial — the page's signature: a guided tour of the real tools ─────
// Geometry (viewBox 300×300): ring radius 132, tick radius 126. Tick positions
// are emitted as percentages so the whole instrument scales with its container.
const DIAL = 300
const DIAL_C = DIAL / 2
const RING_R = 132
const TICK_R = 126
const RING_C = 2 * Math.PI * RING_R
const ARC_GAP = 12
const TOUR_MS = 2200

function ArmatureDial({ items, reduced }: { items: AboutTool[]; reduced: boolean }) {
  const [active, setActive] = useState<number | null>(null)
  const [pinned, setPinned] = useState(false)
  const tickRefs = useRef<Array<HTMLButtonElement | null>>([])
  const count = items.length
  // Guard an all-disabled catalog so the ring never computes NaN dash metrics.
  const seg = count ? RING_C / count : 0
  const dash = Math.max(0, seg - ARC_GAP)

  /* The guided tour: the dial walks the floor by itself until the visitor
     takes the wheel. Reduced motion: it never starts. Hidden tab: the
     interval is throttled by the browser, and the tour is honest data
     anyway — no feedback is fabricated. */
  useEffect(() => {
    if (pinned || reduced || count < 2) return
    const t = window.setInterval(() => {
      setActive((a) => (a === null ? 0 : (a + 1) % count))
    }, TOUR_MS)
    return () => window.clearInterval(t)
  }, [pinned, reduced, count])

  const takeOver = () => {
    if (!pinned) setPinned(true)
  }

  /* The mark turns a few pixels toward whichever arc is active (its own gaze,
     driven here rather than by editing the shared AnimatedBrandLogo). */
  let gazeX = 0
  let gazeY = 0
  let rotation = -90
  if (active !== null && count) {
    const deg = -90 + active * (360 / count)
    rotation = deg
    const rad = (deg * Math.PI) / 180
    gazeX = Math.cos(rad) * 7
    gazeY = Math.sin(rad) * 7
  }

  // Roving tabindex + arrow keys: the dial is one composite instrument.
  const move = (dir: 1 | -1) => {
    if (!count) return
    takeOver()
    const from = active === null ? 0 : active
    const next = (from + dir + count) % count
    setActive(next)
    tickRefs.current[next]?.focus()
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Home') { e.preventDefault(); takeOver(); setActive(0); tickRefs.current[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); takeOver(); setActive(count - 1); tickRefs.current[count - 1]?.focus() }
  }

  const activeTool = active === null ? null : items[active]

  return (
    <>
      <div className={styles.dialHead}>
        <span className={styles.monoLabel}>Instrument index</span>
        <span className={`${styles.monoLabel} ${styles.tourLabel}`} aria-hidden="true">
          {pinned ? 'MANUAL' : 'AUTO TOUR'}
        </span>
      </div>

      <div className={styles.dial}>
        <svg className={styles.dialRing} viewBox={`0 0 ${DIAL} ${DIAL}`} aria-hidden="true">
          <circle className={styles.ringTrack} cx={DIAL_C} cy={DIAL_C} r={RING_R} />
          <circle
            className={styles.ringActive}
            cx={DIAL_C}
            cy={DIAL_C}
            r={RING_R}
            strokeDasharray={`${dash} ${RING_C - dash}`}
            style={{ opacity: active === null ? 0 : 1, transform: `rotate(${rotation}deg)` }}
          />
        </svg>

        <span
          className={styles.dialMark}
          style={{ transform: `translate(-50%, -50%) translate(${gazeX}px, ${gazeY}px)` }}
        >
          <AnimatedBrandLogo className={styles.dialLogo} />
        </span>

        {items.map((tool, i) => {
          const deg = -90 + i * (360 / count)
          const rad = (deg * Math.PI) / 180
          const x = ((DIAL_C + Math.cos(rad) * TICK_R) / DIAL) * 100
          const y = ((DIAL_C + Math.sin(rad) * TICK_R) / DIAL) * 100
          const isActive = i === active
          return (
            <button
              key={tool.href}
              ref={(el) => { tickRefs.current[i] = el }}
              type="button"
              className={`${styles.tick}${isActive ? ` ${styles.tickActive}` : ''}`}
              style={{ left: `${x}%`, top: `${y}%` }}
              onMouseEnter={() => { takeOver(); setActive(i) }}
              onFocus={() => { takeOver(); setActive(i) }}
              onClick={() => { takeOver(); setActive(i) }}
              onKeyDown={onKeyDown}
              aria-label={`${String(i + 1).padStart(2, '0')} — ${tool.label}`}
              aria-pressed={isActive}
              tabIndex={active === i ? 0 : active === null ? (i === 0 ? 0 : -1) : -1}
            >
              <span className={styles.tickNum}>{String(i + 1).padStart(2, '0')}</span>
            </button>
          )
        })}
      </div>

      {/* the readout — crossfades as the tour moves between real entries */}
      <div className={styles.readout} key={activeTool?.href ?? 'atlas'}>
        {activeTool ? (
          <>
            <span className={styles.glyphSlot}>
              {activeTool.variant ? (
                <LayeredIcon variant={activeTool.variant} />
              ) : (
                <span className={styles.glyphTile}>{activeTool.glyph}</span>
              )}
            </span>
            <span className={styles.readoutText}>
              <span className={styles.readoutLabel}>{activeTool.label}</span>
              <span className={styles.readoutDesc}>{activeTool.desc}</span>
            </span>
            <Link href={activeTool.href} className={styles.readoutLink}>
              Open tool
              <span className={styles.readoutArrow}>{arrow}</span>
            </Link>
          </>
        ) : (
          <span className={styles.readoutText}>
            <span className={styles.readoutLabel}>{count} instruments, one workshop</span>
            <span className={styles.readoutDesc}>
              The dial is walking the floor — touch it any time to steer.
            </span>
          </span>
        )}
      </div>
    </>
  )
}

//── Reduced motion as a real state, not an effect-side setState ───────────────
const subscribeReduced = (onChange: () => void) => {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
const getReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const getReducedServer = () => false

export default function AboutUsClient({ monoClass = '' }: { monoClass?: string }) {
  const { enabled } = useToolAvailability()
  const openTools = tools.filter((tool) => {
    const toolId = toolIdForHref(tool.href)
    return !toolId || enabled(toolId)
  })
  const toolCount = openTools.length

  const rootRef = useRef<HTMLElement>(null)
  const reduced = useSyncExternalStore(subscribeReduced, getReduced, getReducedServer)

  // One reveal observer for the whole page; the reveal class is applied in
  // JSX now, so the choreography is actually wired (no dead data-reveal).
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (!nodes.length) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach((n) => (n.dataset.shown = 'true'))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          ;(entry.target as HTMLElement).dataset.shown = 'true'
          observer.unobserve(entry.target)
        })
      },
      { rootMargin: '0px 0px -12% 0px' },
    )
    nodes.forEach((n) => observer.observe(n))
    return () => observer.disconnect()
  }, [])

  return (
    <div className="home-page">
      <Topbar2 openFileHref="/#heroFile" />

      <main id="main-content" className={`${styles.page} ${monoClass}`} ref={rootRef}>
        <div className={styles.shell}>

          {/* ── HERO · the Armature Dial, walking the floor ─────────── */}
          <section className={styles.hero}>
            <div className={styles.dialWrap}>
              <ArmatureDial items={openTools} reduced={reduced} />
            </div>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>
                About <span className={styles.eyebrowSpan} lang="bn">· আমাদের কথা</span>
              </p>
              <h1 className={styles.title}>
                Documents, handled like
                <span className={styles.titleAccent}> craftsmanship.</span>
              </h1>
              <p className={styles.lede}>
                mycloove builds precise, private document tools — designed with
                the care of a workshop, not the noise of a marketplace.
              </p>
              <div className={styles.specStrip} aria-hidden="true">
                <span className={styles.specItem}>EST. 2026</span>
                <span className={styles.specItem}>PRIVACY-FIRST</span>
                <span className={`${styles.specItem} ${styles.specItemNum}`}>{toolCount} INSTRUMENTS</span>
              </div>
            </div>
          </section>

          {/* ── ORIGIN · the name (clove / cleave) ──────────────────── */}
          <section className={`${styles.origin} ${styles.reveal}`} data-reveal>
            <div>
              <p className={styles.eyebrow}>The name</p>
              <h2 className={styles.originTitle}>Clove and cleave.</h2>
              <p className={styles.originBody}>
                mycloove is named for the two ways a document moves. <em>Clove</em> is a
                small bud; <em>cleave</em> means to join or to part. Merging pages,
                splitting a file, lifting text out of a scan — it is all cleaving.
              </p>
              <p className={styles.originBody}>
                The doubled O in our wordmark is the clasp: two beads holding the name
                together, in the same blue as the octopus who runs this workshop.
              </p>
            </div>
            <div className={styles.beadField} aria-hidden="true">
              <span className={`${styles.bead} ${styles.beadA}`} />
              <span className={`${styles.bead} ${styles.beadB}`} />
            </div>
          </section>

          {/* ── THE INSTRUMENTS · ledger grouped by capability ──────── */}
          <section className={styles.section}>
            <div className={`${styles.sectionHead} ${styles.reveal}`} data-reveal>
              <span className={styles.sectionIndex}>01 · Instruments</span>
              <h2 className={styles.sectionTitle}>
                {toolCount} focused tools.{' '}
                <span className={styles.sectionTitleMuted}>Zero clutter.</span>
              </h2>
            </div>
            <div className={`${styles.ledger} ${styles.reveal}`} data-reveal>
              {GROUP_ORDER.map((group) => {
                const items = openTools.filter((tool) => tool.group === group)
                if (!items.length) return null
                return (
                  <div className={styles.ledgerGroup} key={group}>
                    <div className={styles.ledgerLabel}>
                      <span className={styles.ledgerCount}>{String(items.length).padStart(2, '0')}</span>
                      <span className={styles.ledgerName}>{group}</span>
                    </div>
                    <div className={styles.ledgerCells}>
                      {items.map((t) => (
                        <Link key={t.href} href={t.href} className={styles.cell}>
                          <span className={styles.glyphSlot}>
                            {t.variant ? <LayeredIcon variant={t.variant} /> : <span className={styles.glyphTile}>{t.glyph}</span>}
                          </span>
                          <span className={styles.cellBody}>
                            <span className={styles.cellLabel}>{t.label}</span>
                            <span className={styles.cellDesc}>{t.desc}</span>
                          </span>
                          <span className={styles.cellArrow} aria-hidden="true">{arrow}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* ── WORKING RULES ───────────────────────────────────────── */}
          <section className={styles.section}>
            <div className={`${styles.sectionHead} ${styles.reveal}`} data-reveal>
              <span className={styles.sectionIndex}>02 · Working rules</span>
              <h2 className={styles.sectionTitle}>Principles over promises.</h2>
            </div>
            <div className={`${styles.principles} ${styles.reveal}`} data-reveal>
              {principles.map((p, i) => (
                <div className={styles.principle} key={p.title}>
                  <span className={styles.principleNum} aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  <span className={styles.principleIcon}>{p.icon}</span>
                  <div>
                    <div className={styles.principleTitle}>{p.title}</div>
                    <div className={styles.principleDesc}>{p.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── PROMISE ─────────────────────────────────────────────── */}
          <section className={`${styles.promise} ${styles.reveal}`} data-reveal>
            <span className={styles.promiseSeal} aria-hidden="true">
              <span className={styles.promiseRing} />
              <span className={styles.promiseStar}>{glyph.star}</span>
            </span>
            <h2 className={styles.promiseTitle}>Private by design.</h2>
            <p className={styles.promiseBody}>
              Files are processed and deleted — never stored, never profiled. No
              account required.
            </p>
          </section>

          {/* ── CTA ─────────────────────────────────────────────────── */}
          <section className={`${styles.cta} ${styles.reveal}`} data-reveal>
            <h2 className={styles.ctaTitle}>Begin with a file.</h2>
            <div className={styles.ctaActions}>
              <Link href="/#heroFile" className={styles.btnPrimary}>Open a file</Link>
              <Link href="/#tools" className={styles.btnQuiet}>Explore the tools</Link>
            </div>
            <p className={styles.ctaNote}>
              Free within a fair allowance — <Link href="/pricing">see pricing</Link>. Or{' '}
              <Link href="/contact-us">talk to the workshop</Link> directly.
            </p>
          </section>

        </div>
      </main>

      <HomeFooter />
    </div>
  )
}
