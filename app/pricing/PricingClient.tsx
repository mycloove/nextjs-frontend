'use client'

/*
  Pricing — "The Calibration Bench".

  Instrument concept: the plate a workshop pins beside its bench, redrawn as a
  bench you can operate. One honest plan plate, one toggle between the two real
  viewer states — not signed in, or a free account — and one sealed strip that
  refuses to invent a price.

  The marketing page never quotes a frozen allowance. Admin policies are live;
  the account control owns the authoritative balance and each billable action
  discloses its cost. Until credit activation, legacy fair-use limits remain.

  Category default (two mirrored pricing cards, "$0" vs "coming soon", two
  tick lists, a fake countdown, a hero "10 calls" figure) is rejected on
  purpose: nothing is on sale here, so the page draws one plate, one state
  toggle, and one refusal to invent a price.

  Only the tool inventory crosses from the catalog. A seed guest/member cap
  cannot promise that the deployed account allowance is higher.
  Palette: the marketing surface (app/home.css, both themes) plus the mycloove
  blue accent shared with About/Contact. The one commit action stays the ink
  stamp (ink on canvas ≥15:1 both themes — far above a white-on-blue label in
  dark). State phrases use IBM Plex Mono, loaded module-locally in page.tsx.
*/

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

import HomeFooter from '@/components/HomeFooter'
import Topbar2 from '@/components/Topbar2'

import styles from './Pricing.module.css'

import '../home.css'

type Viewer = 'guest' | 'account'

const arrow = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="4" y1="12" x2="20" y2="12" />
    <polyline points="13 5 20 12 13 19" />
  </svg>
)

const lock = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

export type PricingProps = {
  toolCount: number
  monoClass?: string
}

export default function PricingClient({ toolCount, monoClass = '' }: PricingProps) {
  const rootRef = useRef<HTMLElement>(null)
  const [viewer, setViewer] = useState<Viewer>('guest')

  /* The two real states, phrased without a quota figure. The headline is the
     readout that rolls on flip; the note does the explaining. */
  const planFor = (v: Viewer) =>
    v === 'guest'
      ? {
          headline: 'Fair-use allowance',
          note:
            'Work within a fair allowance, straight away — no sign-up, no card. ' +
           'Open your avatar to see the current allowance. When credits are enabled, ' +
           'one balance covers billable tools and the action shows its cost.',
        }
      : {
            headline: 'Account allowance',
            note:
              'Signing in links your guest activity and keeps recent conversions on record. ' +
              'Your current account allowance appears in the avatar menu. No card or subscription is required.',
          }

  /* Included with every way in — the plan's shape, no quotas quoted. */
  const included = [
    { b: `All ${toolCount} instruments`, s: 'the full bench — converters, editors, Document AI' },
    { b: 'A clear allowance', s: 'the account menu shows your balance; billable actions show their credit cost' },
    { b: 'Zero storage', s: 'files are processed, then removed' },
    { b: 'Bangla native', s: 'Unicode and Bijoy handled as first-class scripts' },
  ]

  /* The allowance, explained — derived wording only, no cap figures. */
  const rules = [
    {
      title: 'The balance is live.',
      desc:
        'Your avatar opens the account balance. Once credit mode is enabled, ' +
        'billable tools share that pool and show their cost before work starts. Legacy deployments keep their existing fair-use limits.',
    },
    {
      title: 'Signing in links your work.',
      desc:
        'Guest and account allowances are configured separately. Signing in links guest spend once, ' +
        'rather than adding an unused guest balance to your account. Your files are handled the same way.',
    },
    {
      title: 'It refills on its own.',
      desc:
        'Settled spend returns as its rolling window expires; the account menu shows the next actual return. ' +
        'Credits held for failed or refused work are released. Credits are a free-use allowance, not money.',
    },
  ]

  // Reveal choreography: this page applies the reveal class properly.
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

  const plan = planFor(viewer)

  return (
    <div className="home-page">
      <Topbar2 openFileHref="/" />

      <main id="main-content" className={`${styles.page} ${monoClass}`} ref={rootRef}>
        <div className={styles.shell}>

          {/* ── HERO ─────────────────────────────────────────────────── */}
          <section className={styles.hero}>
            <p className={styles.eyebrow}>
              Pricing <span className={styles.eyebrowSpan} lang="bn">· মূল্য</span>
            </p>
            <h1 className={styles.title}>
              Free to use.
              <span className={styles.titleAccent}>Fair by design.</span>
            </h1>
            <p className={styles.lede}>
              Every tool in the workshop is free within a fair allowance — no
              card, no account to start. A higher-limit Pro plan is planned,
              and it is not for sale.
            </p>
            <div className={styles.specStrip} aria-hidden="true">
              <span className={styles.specItem}>{toolCount} INSTRUMENTS</span>
              <span className={styles.specItem}>NO STORAGE</span>
              <span className={styles.specItem}>NO CARD</span>
            </div>
          </section>

          {/* ── THE PLATE · the one plan actually on offer ───────────── */}
          <section className={`${styles.plate} ${styles.reveal}`} data-reveal aria-labelledby="plate-free-title">
            <div className={styles.plateHead}>
              <div>
                <p className={styles.plateTag}>Plan · the only one today</p>
                <h2 id="plate-free-title" className={styles.planName}>Free</h2>
                <p className={styles.planNote}>The whole workshop, within a fair allowance.</p>
              </div>
              <div className={styles.priceBlock}>
                <span className={styles.priceValue}>$0</span>
                <span className={styles.priceMeta}>No card, no account to start.</span>
              </div>
            </div>

            <div className={styles.plateRule} aria-hidden="true" />

            {/* the plan readout — flip the state and the phrase rolls */}
            <div className={styles.meterBlock}>
              <div className={styles.meterHead}>
                <span className={styles.meterLabel}>Show the plan for</span>
                <div className={styles.seg} role="group" aria-label="Show the plan for">
                  <button
                    type="button"
                    onClick={() => setViewer('guest')}
                    aria-pressed={viewer === 'guest'}
                    className={`${styles.segBtn}${viewer === 'guest' ? ` ${styles.segOn}` : ''}`}
                  >
                    Not signed in
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewer('account')}
                    aria-pressed={viewer === 'account'}
                    className={`${styles.segBtn}${viewer === 'account' ? ` ${styles.segOn}` : ''}`}
                  >
                    Free account
                  </button>
                </div>
              </div>

              <div className={styles.meterRow} aria-live="polite">
                {/* keyed so each flip rolls the readout */}
                <b key={viewer} className={styles.readoutPhrase}>{plan.headline}</b>
                <p key={`${viewer}-note`} className={styles.stateNote}>{plan.note}</p>
              </div>
            </div>

            <div className={styles.plateRule} aria-hidden="true" />

            {/* the ledger — what the plan includes, however you walk in */}
            <p className={styles.meterLabel}>Included, however you walk in</p>
            <div className={styles.facts}>
              {included.map((item) => (
                <div className={styles.fact} key={item.b}>
                  <b>{item.b}</b>
                  <span>{item.s}</span>
                </div>
              ))}
            </div>

            <div className={styles.plateCta}>
              <Link href="/#heroFile" className={styles.btnPrimary}>Start with a file</Link>
            </div>
            <p className={styles.finePrint}>
              The account control shows the current credit policy and balance.
              Tool costs and allowances can change; the server validates each action.
              No paid credit purchase or subscription is offered here.
            </p>
          </section>

          {/* ── 01 · The meter, explained ────────────────────────────── */}
          <section className={styles.section} aria-labelledby="meter-title">
            <div className={`${styles.sectionHead} ${styles.reveal}`} data-reveal>
              <span className={styles.sectionIndex}>01 · Credits</span>
              <h2 id="meter-title" className={styles.sectionTitle}>The allowance, explained.</h2>
            </div>
            <div className={styles.rules}>
              {rules.map((rule, i) => (
                <div className={`${styles.rule} ${styles.reveal}`} data-reveal key={rule.title}>
                  <span className={styles.ruleNum} aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <div className={styles.ruleTitle}>{rule.title}</div>
                    <p className={styles.ruleDesc}>{rule.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── 02 · The sealed plan ─────────────────────────────────── */}
          <section className={styles.section} aria-labelledby="pro-title">
            <div className={`${styles.sectionHead} ${styles.reveal}`} data-reveal>
              <span className={styles.sectionIndex}>02 · On the bench</span>
              <h2 id="pro-title" className={styles.sectionTitle}>Pro is planned. It is not for sale.</h2>
            </div>
            <div className={`${styles.sealed} ${styles.reveal}`} data-reveal>
              <span className={styles.sealedTag}>
                {lock}
                Planned — no price set
              </span>
              <p className={styles.sealedBody}>
                A higher-limit plan is being built. When it is real, its terms
                will be written here first — until then, this page is the whole
                story: free within the allowance, nothing else on sale.
              </p>
              <Link href="/contact-us" className={styles.sealedLink}>
                Tell us what you would need from it
                <span aria-hidden="true">{arrow}</span>
              </Link>
            </div>
          </section>

          <p className={styles.closing}>
            Questions about how limits work? See the <Link href="/faq">FAQ</Link>,
            or read how we handle your files in the{' '}
            <Link href="/privacy">privacy policy</Link>.
          </p>

        </div>
      </main>

      <HomeFooter />
    </div>
  )
}
