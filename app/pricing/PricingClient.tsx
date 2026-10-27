'use client'

/*
  Pricing - The Open Folio: a document-shaped access sheet that puts the real
  price beside the work it makes possible. Editorial minimalism, with one
  folded-paper detail; not a grid of invented subscription tiers or glass cards.

  The access comparison is explanatory, never authentication or plan selection.
  Only the catalogue count crosses the server boundary. Allowances and action
  costs remain live policy, owned by the account control and each workspace.
  No seed quotas, paid checkout, or automatic account upgrade are promised here.
*/

import { useState } from 'react'
import Link from 'next/link'

import HomeFooter from '@/components/HomeFooter'
import Topbar2 from '@/components/Topbar2'

import styles from './Pricing.module.css'
import '../home.css'

type Viewer = 'guest' | 'account'

const access = {
  guest: {
    label: 'Guest access',
    title: 'Start with a file, not a form.',
    description: 'Try guest-ready tools straight away. Some tools and actions need a free account; the workspace will let you know.',
    rows: [
      ['Getting started', 'No sign-up for guest-ready tools'],
      ['Your allowance', 'The current guest allowance'],
      ['When you sign in', 'Your guest activity links to your account'],
    ],
  },
  account: {
    label: 'Free account',
    title: 'Keep your work connected.',
    description: 'Sign in to use account-required actions and keep recent conversions on record. No card or subscription is needed.',
    rows: [
      ['Getting started', 'Sign in with a free account'],
      ['Your allowance', 'The current account allowance'],
      ['When you sign in', 'Guest spend is linked, not added as bonus credits'],
    ],
  },
} as const

const questions = [
  {
    question: 'Is this a free trial?',
    answer: 'No. Free is the current plan, not a trial that turns into a paid subscription. Use the tools within the current allowance. There is no card to enter and no paid subscription or credit purchase offered here.',
  },
  {
    question: 'How much can I use for free?',
    answer: 'Open your avatar in the account menu to see your current allowance. When credits are enabled, billable tools share one balance and show the action cost before work starts. Allowances and costs can change, so the workspace and account menu are the source of truth. Where credits are not yet enabled, existing fair-use limits apply.',
  },
  {
    question: 'What happens when my allowance runs out?',
    answer: 'In credit mode, used credits return as their rolling usage window expires; the account menu shows the next actual return. They do not necessarily reset at midnight. Credits reserved for failed or refused work are released. Credits are a free-use allowance, not money.',
  },
  {
    question: 'Does signing in give me extra credits?',
    answer: 'Not necessarily. Guest and account allowances are configured separately. Signing in links your guest spend once; it does not add unused guest credits to your account. Check the account menu for your current balance.',
  },
  {
    question: 'What happens to my files?',
    answer: 'File handling and retention depend on the tool. Some editors may save work in your browser. Creating an account does not change those file-handling rules. Read the privacy policy for the details.',
  },
]

function Arrow({ down = false }: { down?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={down ? 'M12 4v16m-6-6 6 6 6-6' : 'M4 12h16m-6-6 6 6-6 6'} />
    </svg>
  )
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  )
}

export type PricingProps = {
  toolCount: number
  fontClass?: string
}

export default function PricingClient({ toolCount, fontClass = '' }: PricingProps) {
  const [viewer, setViewer] = useState<Viewer>('guest')
  const preview = access[viewer]

  return (
    <div className="home-page">
      <Topbar2 openFileHref="/" />

      {/* The root layout owns the main landmark; this remains the skip-link target. */}
      <div id="main-content" className={`${styles.page} ${fontClass}`} tabIndex={-1}>
        <div className={styles.shell}>
          <section className={styles.hero} aria-labelledby="pricing-title">
            <div className={styles.intro}>
              <p className={styles.eyebrow}><span className={styles.shortRule} aria-hidden="true" /> Pricing, with nothing to hide</p>
              <h1 id="pricing-title" className={styles.title}>
                Good work.
                <span>Simply free.</span>
              </h1>
              <p className={styles.lede}>
                Convert, edit, and make sense of your documents.
                A thoughtful workspace, free within your allowance.
              </p>
              <a href="#free-access" className={styles.textLink}>
                Find your way in <Arrow down />
              </a>

              <div className={styles.catalogueNote}>
                <div className={styles.documentMark} aria-hidden="true">
                  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
                    <path className={styles.documentBack} d="M10 13h28l10 10v33H10z" />
                    <path d="M20 5h25l11 11v34H20zM44 5v12h12M28 27h20M28 34h20M28 41h12" />
                  </svg>
                </div>
                <div>
                  <p><strong>{toolCount} tools.</strong> One place to begin.</p>
                  <span>For PDFs, images, text, and the ideas inside.</span>
                </div>
              </div>
            </div>

            <div className={styles.folio}>
              <section className={styles.plan} aria-labelledby="free-plan-title">
                <div className={styles.planHeading}>
                  <div>
                    <p className={styles.label}>Your everyday workspace</p>
                    <h2 id="free-plan-title">Free</h2>
                  </div>
                  <span className={styles.available}><span aria-hidden="true" /> Available now</span>
                </div>

                <div className={styles.priceRow}>
                  <p className={styles.price}><span>$</span>0</p>
                  <p className={styles.priceNote}>No subscription.<br />No card required.</p>
                </div>

                <p className={styles.planDescription}>Everything starts with a little room to work.</p>
                <ul className={styles.included}>
                  <li><Check /><span>A catalogue of {toolCount} document tools</span></li>
                  <li><Check /><span>Guest access on supported tools</span></li>
                  <li><Check /><span>A clear, current free-use allowance</span></li>
                </ul>
                <p className={styles.planCaveat}>Availability and account requirements vary by tool.</p>

                <Link href="/#heroFile" className={styles.primary}>
                  Start with a file <Arrow />
                </Link>
                <p className={styles.planFooter}>No checkout. Just your next document.</p>
              </section>
              <p className={styles.folioCaption}><span aria-hidden="true" /> The free plan. Not a free trial.</p>
            </div>
          </section>

          <section className={styles.toolIndex} aria-labelledby="tool-index-title">
            <div className={styles.indexHeading}>
              <h2 id="tool-index-title" className={styles.label}>Inside the catalogue</h2>
              <Link href="/#tools" className={styles.textLink}>Explore the tools <Arrow /></Link>
            </div>
            <ul className={styles.toolList}>
              <li><span className={styles.format} aria-hidden="true">PDF <span>↔</span> DOCX</span><h3>Convert &amp; organise</h3><p>Change formats. Merge, split, and compress.</p></li>
              <li><span className={styles.format} aria-hidden="true">Aa <span>/</span> <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4h16v16H4zM4 16l5-6 4 4 3-3 4 5" /><circle cx="16" cy="8" r="1.5" /></svg></span><h3>Edit &amp; refine</h3><p>Work with your PDFs and images.</p></li>
              <li><span className={styles.format} aria-hidden="true">DOC <span>→</span> AI</span><h3>Read &amp; understand</h3><p>Extract text. Ask more of your documents.</p></li>
              <li><span className={styles.format} aria-hidden="true">A <span>/</span> <span lang="bn">অ</span></span><h3>Work across scripts</h3><p>Bangla Unicode and Bijoy tools, too.</p></li>
            </ul>
            <p className={styles.indexNote}>Check each workspace for current availability, action costs, and account requirements.</p>
          </section>

          <section id="free-access" className={styles.accessSection} aria-labelledby="access-title">
            <div className={styles.sectionIntro}>
              <p className={styles.eyebrow}>Same free plan. Different starting points.</p>
              <h2 id="access-title" className={styles.sectionTitle}>Come as you are.<br />Make yourself at home.</h2>
              <p>Start as a guest or use a free account. Compare how access works, without changing your account.</p>
              <a href="#pricing-questions" className={styles.textLink}>How the allowance works <Arrow down /></a>
            </div>

            <div className={styles.accessPanel}>
              <div className={styles.segment} role="group" aria-label="Compare free access">
                {(['guest', 'account'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={styles.segmentButton}
                    aria-pressed={viewer === mode}
                    aria-controls="access-preview"
                    onClick={() => setViewer(mode)}
                  >
                    {access[mode].label}
                  </button>
                ))}
              </div>
              <div id="access-preview" className={styles.accessPreview} aria-live="polite" aria-atomic="true">
                <div key={viewer} className={styles.accessCopy}>
                  <p className={styles.label}>{preview.label}</p>
                  <h3>{preview.title}</h3>
                  <p className={styles.accessDescription}>{preview.description}</p>
                  <dl className={styles.accessDetails}>
                    {preview.rows.map(([label, value]) => (
                      <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                    ))}
                  </dl>
                </div>
              </div>
              <p className={styles.accessNote}>Your avatar menu shows your current allowance. Signing in does not guarantee a larger one.</p>
            </div>
          </section>

          <div className={styles.detailsGrid}>
            <section className={styles.pro} aria-labelledby="pro-title">
              <p className={styles.eyebrow}>Looking ahead</p>
              <div className={styles.proHeading}><h2 id="pro-title">Pro</h2><span className={styles.planned}>Planned</span></div>
              <p className={styles.proStatement}>A little more<br /> room to grow.</p>
              <p className={styles.proDescription}>A higher-limit plan is planned for bigger workflows. It is not for sale, and no price or launch date has been set.</p>
              <div className={styles.proRule} aria-hidden="true" />
              <p className={styles.proPrompt}>Help shape what comes next.</p>
              <Link href="/contact-us" className={styles.textLink}>Tell us what you need <Arrow /></Link>
            </section>

            <section id="pricing-questions" className={styles.faq} aria-labelledby="questions-title">
              <p className={styles.eyebrow}>Good questions. Clear answers.</p>
              <h2 id="questions-title" className={styles.sectionTitle}>Know where you stand.</h2>
              <div className={styles.questions}>
                {questions.map(({ question, answer }) => (
                  <details className={styles.question} key={question}>
                    <summary>{question}<span className={styles.plus} aria-hidden="true" /></summary>
                    <div className={styles.answer}><p>{answer}</p>{question === 'What happens to my files?' && <Link href="/privacy" className={styles.inlineLink}>Read the privacy policy <Arrow /></Link>}</div>
                  </details>
                ))}
              </div>
              <p className={styles.faqFooter}>A question we haven&apos;t covered? <Link href="/faq">Visit the FAQ</Link> or <Link href="/contact-us">talk to us</Link>.</p>
            </section>
          </div>
        </div>
      </div>

      <HomeFooter />
    </div>
  )
}
