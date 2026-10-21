'use client'

/*
  Contact — "The Signal Room".

  Instrument concept: contact is a live transmission channel between the
  visitor's desk and the workshop. The composer is an instrument input;
  the message is real mass loaded onto the wire; the right pane is the
  channel's readout — four lamps driven by real field validation, packets
  sized by the real message length, a real clock, an honestly computed
  reply window, and a session log that records only real events.

  Honesty laws (house standard): lamps light only when the requirement is
  really satisfied; in-flight shows an indeterminate sweep, never a fake
  percent; if the mail transport is not configured the link refuses and
  points at the direct email rather than failing silently.

  The form's EmailJS contract is unchanged: every credential and the
  destination address come from the environment (NEXT_PUBLIC_EMAILJS_*,
  NEXT_PUBLIC_CONTACT_EMAIL).

  Console register note: IBM Plex Mono is loaded on this page only
  (page.tsx, next/font) — a regional typographic decision.
*/

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import emailjs from '@emailjs/browser'

import HomeFooter from '@/components/HomeFooter'
import Topbar2 from '@/components/Topbar2'

import styles from './ContactUs.module.css'

import '../home.css'

//── Stroke glyphs (1.8 stroke, currentColor — no emoji anywhere) ─────────────
const glyphMail = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
)
const glyphClock = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15.5 14" />
  </svg>
)
const glyphShield = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)
const glyphSend = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
)
const glyphStatusOk = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <polyline points="16 8.5 10.2 14.5 8 12.2" />
  </svg>
)
const glyphStatusWarn = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)

//── Real mass: packets on the wire derive from the actual message length ─────
const MAX_PACKETS = 10
const PACKET_PER = 90 // chars per packet — both constants are copy-honest limits

//── Lamps: one per real requirement, labelled by the state that satisfies it ─
type LampKey = 'name' | 'email' | 'message' | 'terms'
const LAMPS: Array<{ key: LampKey; label: string }> = [
  { key: 'name', label: 'NAME' },
  { key: 'email', label: 'EMAIL' },
  { key: 'message', label: 'MESSAGE' },
  { key: 'terms', label: 'TERMS' },
]

//── Session log: only real events, newest at the bottom, visible tail ────────
type LogLine = { kind: '' | 'ok' | 'fault'; time: string; key: string; text: string }

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const pad2 = (n: number) => String(n).padStart(2, '0')

export default function ContactUsClient({ monoClass = '' }: { monoClass?: string }) {
  const formRef = useRef<HTMLFormElement>(null)
  const rootRef = useRef<HTMLElement>(null)
  const loggedKeys = useRef(new Set<string>())

  const [formData, setFormData] = useState({
    name: '', email: '', subject: '', message: '',
  })
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [wireMoment, setWireMoment] = useState<'idle' | 'sent' | 'fault'>('idle')
  const [submitStatus, setSubmitStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [logLines, setLogLines] = useState<LogLine[]>([])
  const [clock, setClock] = useState('--:--:--')
  const [responseWindow, setResponseWindow] = useState<{ open: boolean; label: string } | null>(null)

  const SERVICE_ID  = process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID ?? ''
  const TEMPLATE_ID = process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID ?? ''
  const PUBLIC_KEY  = process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY ?? ''
  const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'hello@mycloove.com'
  const emailJsReady = Boolean(SERVICE_ID && TEMPLATE_ID && PUBLIC_KEY)

  // Real completion, not a fabricated progress bar: the four requirements.
  const ready: Record<LampKey, boolean> = {
    name: formData.name.trim().length > 0,
    email: emailRe.test(formData.email.trim()),
    message: formData.message.trim().length > 0,
    terms: acceptTerms,
  }
  const readyCount = Number(ready.name) + Number(ready.email) + Number(ready.message) + Number(ready.terms)
  const allReady = readyCount === 4

  // Packet mass on the wire = the visitor's actual message length.
  const packetCount = Math.min(MAX_PACKETS, Math.ceil(formData.message.trim().length / PACKET_PER))

  const pushLog = useCallback((kind: LogLine['kind'], key: string, text: string) => {
    const now = new Date()
    setLogLines((prev) => [
      ...prev.slice(-5),
      { kind, time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`, key, text },
    ])
  }, [])
  // One line per changed fact — never per keystroke.
  const logOnce = useCallback((on: boolean, key: string, okText: string, offText: string) => {
    if (on && !loggedKeys.current.has(key)) {
      loggedKeys.current.add(key)
      pushLog('ok', key, okText)
    } else if (!on && loggedKeys.current.has(key)) {
      loggedKeys.current.delete(key)
      pushLog('', key, offText)
    }
  }, [pushLog])

  // ── scroll reveal — this page actually applies the reveal class ──
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

  // ── lamp log: logs fire as the requirements really change state ──
  useEffect(() => {
    if (ready.name) logOnce(true, 'lamp-name', 'name recorded ✓', 'name released')
    if (ready.email) logOnce(true, 'lamp-email', 'email recorded ✓', 'email released')
    if (ready.message) logOnce(true, 'lamp-message', 'message loaded ✓', 'message released')
    if (ready.terms) logOnce(true, 'lamp-terms', 'terms accepted ✓', 'terms released')
  }, [logOnce, ready.name, ready.email, ready.message, ready.terms])

  // ── the real clock + an honestly computed reply window ──
  useEffect(() => {
    // SSR renders the placeholders; the drift-free hydration contract is
    // that this interval owns the surface from the first tick onward.
    const tick = () => {
      const d = new Date()
      setClock(`${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`)
      const day = d.getDay() // 0 Sun … 6 Sat
      const h = d.getHours()
      if (day >= 1 && day <= 5 && h >= 9 && h < 18) {
        setResponseWindow({ open: true, label: 'replies within 24–48 h' })
      } else {
        const next = new Date(d)
        if (h >= 9) next.setDate(next.getDate() + 1) // before 09:00 today → opens today
        while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1)
        const label = next.toDateString() === d.toDateString() ? 'today 09:00' : `${DAY_NAMES[next.getDay()]} 09:00`
        setResponseWindow({ open: false, label })
      }
    }
    tick()
    const t = window.setInterval(tick, 1000)
    return () => window.clearInterval(t)
  }, [])

  // ── wire failure/success flash ──
  const flashWire = (state: 'sent' | 'fault', line: LogLine['key'], text: string, kind: LogLine['kind']) => {
    setWireMoment(state)
    pushLog(kind, line, text)
    const t = window.setTimeout(() => setWireMoment('idle'), 2600)
    return t
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((p) => ({ ...p, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    const missing = [
      !formData.name && 'name',
      !(emailRe.test(formData.email.trim()) && formData.email) && 'email',
      !formData.message && 'message',
      !acceptTerms && 'terms',
    ].filter(Boolean) as string[]
    if (missing.length > 0) {
      flashWire('fault', 'LINK', `refused — incomplete: ${missing.join(', ')}`, 'fault')
      setSubmitStatus({ type: 'error', message: 'Please fill in all required fields.' })
      return
    }
    if (!emailJsReady) {
      // truth-telling beats silence: the transport is not configured yet
      flashWire('fault', 'LINK', 'transport not configured — direct email given', 'fault')
      setSubmitStatus({
        type: 'error',
        message: `The contact form is not configured yet. Please email us directly at ${CONTACT_EMAIL}.`,
      })
      return
    }

    setIsSubmitting(true)
    setSubmitStatus(null)
    pushLog('ok', 'CHANNEL', 'transmit initiated…')
    try {
      await emailjs.send(SERVICE_ID, TEMPLATE_ID, {
        from_name: formData.name,
        from_email: formData.email,
        subject: formData.subject || 'No Subject',
        message: formData.message,
        to_email: CONTACT_EMAIL,
      }, PUBLIC_KEY)
      flashWire('sent', 'TRANSPORT', `delivered to the workshop desk — reply within 24–48 h`, 'ok')
      setSubmitStatus({ type: 'success', message: "Message sent! We'll get back to you within 24–48 hours." })
      setFormData({ name: '', email: '', subject: '', message: '' })
      setAcceptTerms(false)
      formRef.current?.reset()
    } catch {
      flashWire('fault', 'TRANSPORT', 'failed — the message is still on your desk. try again or email us directly', 'fault')
      setSubmitStatus({ type: 'error', message: 'Something went wrong. Please try again later.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const linkState = isSubmitting ? 'TRANSMITTING' : allReady ? 'ARMED' : 'STANDBY'
  const composeState = isSubmitting ? 'IN FLIGHT' : allReady ? 'READY' : 'DRAFT'

  return (
    <div className="home-page">
      <Topbar2 openFileHref="/#heroFile" />

      <main id="main-content" className={`${styles.page} ${monoClass}`} ref={rootRef}>
        <div className={styles.shell}>

          {/* ── HERO ─────────────────────────────────────────────── */}
          <section className={styles.hero}>
            <p className={styles.eyebrow}>
              Contact <span className={styles.eyebrowSpan} lang="bn">· যোগাযোগ</span>
            </p>
            <h1 className={styles.title}>
              Open a channel to <span className={styles.titleAccent}>the workshop.</span>
            </h1>
            <p className={styles.lede}>
              Behind this page are the people who build the instruments you use —
              not a funnel, not a ticket queue. Write to us; a person reads it
              and replies within one business day.
            </p>
            <p className={styles.ledeBn} lang="bn">
              আপনার প্রতিটি বার্তা সোজা দলের ইনবক্সে পৌঁছায় — পড়বে <b>মানুষ</b>, বট নয়।
            </p>
            <div className={styles.heroMeta}>
              <span><span className={styles.heroMetaLabel}>ONE INBOX</span>{CONTACT_EMAIL}</span>
              <span><span className={styles.heroMetaLabel}>REPLY WINDOW</span>24–48 hours</span>
              <span><span className={styles.heroMetaLabel}>HOURS</span>Mon–Fri · 09:00–18:00</span>
            </div>
          </section>

          {/* ── THE CONSOLE: composer + channel readout ─────────── */}
          <div className={`${styles.console} ${styles.reveal}`} data-reveal>

            {/* composer — the page's single focal surface */}
            <section className={styles.composer} aria-label="Composer">
              <div className={styles.consoleHead}>
                <span className={styles.monoLabel}>Composer — dispatch</span>
                <span className={`${styles.monoLabel} ${styles.stateLabel}${allReady || isSubmitting ? ` ${styles.stateLabelArmed}` : ''}`}>
                  {composeState}
                </span>
              </div>

              <form ref={formRef} onSubmit={handleSubmit} noValidate>
                <div className={styles.formRow}>
                  {/* name */}
                  <div className={`${styles.field}${formData.name ? ` ${styles.fieldFilled}` : ''}`}>
                    <input id="name" name="name" type="text" value={formData.name}
                      onChange={handleChange} required autoComplete="name" className={styles.inputBase} />
                    <span className={styles.rail}><i className={styles.railFill} /></span>
                    <i className={`${styles.tick} ${styles.tickA}`} /><i className={`${styles.tick} ${styles.tickB}`} /><i className={`${styles.tick} ${styles.tickC}`} />
                    <label htmlFor="name">Full name<span className={styles.req}>*</span></label>
                  </div>
                  {/* email */}
                  <div className={`${styles.field}${formData.email ? ` ${styles.fieldFilled}` : ''}`}>
                    <input id="email" name="email" type="email" value={formData.email}
                      onChange={handleChange} required autoComplete="email" className={styles.inputBase} />
                    <span className={styles.rail}><i className={styles.railFill} /></span>
                    <i className={`${styles.tick} ${styles.tickA}`} /><i className={`${styles.tick} ${styles.tickB}`} /><i className={`${styles.tick} ${styles.tickC}`} />
                    <label htmlFor="email">Email address<span className={styles.req}>*</span></label>
                  </div>
                </div>

                {/* subject */}
                <div className={`${styles.field}${formData.subject ? ` ${styles.fieldFilled}` : ''}`}>
                  <input id="subject" name="subject" type="text" value={formData.subject}
                    onChange={handleChange} className={styles.inputBase} />
                  <span className={styles.rail}><i className={styles.railFill} /></span>
                  <i className={`${styles.tick} ${styles.tickA}`} /><i className={`${styles.tick} ${styles.tickFull1}`} /><i className={`${styles.tick} ${styles.tickFull2}`} /><i className={`${styles.tick} ${styles.tickC}`} />
                  <label htmlFor="subject">Subject — feedback, question, idea</label>
                </div>

                {/* message */}
                <div className={`${styles.field}${formData.message ? ` ${styles.fieldFilled}` : ''}`}>
                  <textarea id="message" name="message" rows={5} value={formData.message}
                    onChange={handleChange} required maxLength={1000} aria-describedby="cuCharcount"
                    className={styles.inputBase} />
                  <span className={styles.rail}><i className={styles.railFill} /></span>
                  <i className={`${styles.tick} ${styles.tickA}`} /><i className={`${styles.tick} ${styles.tickFull1}`} /><i className={`${styles.tick} ${styles.tickFull2}`} /><i className={`${styles.tick} ${styles.tickC}`} />
                  <label htmlFor="message">Message<span className={styles.req}>*</span></label>
                  <span
                    id="cuCharcount"
                    className={`${styles.charcount}${formData.message.length >= 1000 ? ` ${styles.charcountOver}` : ''}`}
                  >
                    {formData.message.length} / 1000
                  </span>
                </div>

                {/* terms */}
                <label className={styles.terms}>
                  <span className={styles.checkboxWrap}>
                    <input
                      type="checkbox"
                      checked={acceptTerms}
                      onChange={(e) => setAcceptTerms(e.target.checked)}
                      className={styles.checkboxInput}
                    />
                    <span className={styles.checkboxBox}>
                      {acceptTerms && (
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor"
                          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="2,6 5,9 10,3" />
                        </svg>
                      )}
                    </span>
                  </span>
                  <span className={styles.termsText}>
                    I accept the{' '}
                    <Link href="/terms" className={styles.link} onClick={(e) => e.stopPropagation()}>
                      Terms &amp; Conditions
                    </Link>{' '}
                    and the{' '}
                    <Link href="/privacy" className={styles.link} onClick={(e) => e.stopPropagation()}>
                      Privacy Policy
                    </Link>
                    .
                  </span>
                </label>

                {submitStatus && (
                  <div className={`${styles.status} ${submitStatus.type === 'success' ? styles.success : styles.error}`} role="alert">
                    <span className={styles.statusIcon}>
                      {submitStatus.type === 'success' ? glyphStatusOk : glyphStatusWarn}
                    </span>
                    {submitStatus.message}
                  </div>
                )}

                <button type="submit" disabled={isSubmitting} className={styles.submitBtn}>
                  {isSubmitting ? (
                    <><span className={styles.spinner} />Transmitting…</>
                  ) : (
                    <>Transmit message{glyphSend}</>
                  )}
                </button>
              </form>
            </section>

            {/* the channel — the page's readout */}
            <section className={styles.channel} aria-label="Channel readout">
              <div className={styles.consoleHead}>
                <span className={styles.monoLabel}>Channel — link state</span>
                <span className={`${styles.monoLabel} ${styles.stateLabel}${allReady ? ` ${styles.stateLabelArmed}` : ''}`}>
                  {linkState}
                </span>
              </div>

              {/* lamps: real requirements, real state */}
              <div className={styles.lamps}>
                {LAMPS.map((lamp) => (
                  <span key={lamp.key} className={[
                    styles.lamp,
                    ready[lamp.key] ? styles.lampOn : '',
                    !ready[lamp.key] && (
                      (lamp.key === 'name' && formData.name.length > 0) ||
                      (lamp.key === 'email' && formData.email.length > 0) ||
                      (lamp.key === 'message' && formData.message.length > 0) ||
                      lamp.key === 'terms'
                    ) ? styles.lampTarget : '',
                  ].join(' ')}>
                    <i className={styles.lampDot} />
                    {lamp.label}
                    <small className={styles.lampState}>{ready[lamp.key] ? 'recorded' : 'waiting'}</small>
                  </span>
                ))}
              </div>

              {/* the wire */}
              <div className={[
                styles.wireRow,
                allReady && !isSubmitting ? styles.wireArmed : '',
                isSubmitting ? styles.wireFlight : '',
                wireMoment === 'sent' ? styles.wireSent : '',
                wireMoment === 'fault' ? styles.wireFault : '',
              ].join(' ')}>
                <div className={`${styles.wireSide} ${styles.wireYour}`}>
                  <div className={styles.wireTerm}>
                    <span className={styles.monoLabel}><b>YOUR DESK</b></span>
                    <small>mass {packetCount} pkt</small>
                  </div>
                  <p className={styles.wireNote}>
                    packets = your message&apos;s<br />real length. nothing invented.
                  </p>
                </div>

                <div className={styles.wireRail} aria-hidden="true">
                  <i className={styles.wireCore} />
                  <i className={`${styles.wireCap} ${styles.capTop}`} />
                  <span className={styles.packets}>
                    {Array.from({ length: packetCount }, (_, i) => (
                      <i key={i} className={styles.pkt} style={{ animationDelay: `${i * 30}ms` }} />
                    ))}
                  </span>
                  <span className={styles.sparkTrack} aria-hidden="true"><i className={styles.spark} /></span>
                  <i className={`${styles.wireCap} ${styles.capBottom}`} />
                </div>

                <div className={styles.wireSide}>
                  <div className={styles.wireTerm}>
                    <span className={styles.monoLabel}><b>THE WORKSHOP</b></span>
                    <small>mycloove · team inbox</small>
                  </div>
                  <p className={styles.wireNote}>
                    arrives inside the reply<br />window — never queued dark.
                  </p>
                </div>
              </div>

              {/* session log — aria-live so screen readers hear the honest state */}
              <div className={styles.log} role="log" aria-live="polite">
                {logLines.length === 0 && (
                  <div className={styles.logEmpty}>session begins with your first keystroke — every line here is real</div>
                )}
                {logLines.map((line, i) => (
                  <div key={`${line.time}-${line.key}-${i}`} className={[
                    styles.logLine,
                    line.kind === 'ok' ? styles.logOk : '',
                    line.kind === 'fault' ? styles.logFault : '',
                  ].join(' ')}>
                    <b className={styles.logTime}>{line.time}</b>
                    <span><span className={styles.logKey}>{line.key}</span> {line.text}</span>
                  </div>
                ))}
              </div>

              {/* clock — real local time, honest reply window */}
              <div className={styles.clockRow}>
                <div>
                  <span className={styles.monoLabel}>Desk time (your local)</span>
                  <div className={styles.clock}>{clock}</div>
                </div>
                {responseWindow && (
                  <div className={`${styles.window}${responseWindow.open ? ` ${styles.windowOk}` : ` ${styles.windowClosed}`}`}>
                    {responseWindow.open ? 'WINDOW OPEN' : 'WINDOW CLOSED'}
                    <br />
                    <b>{responseWindow.label}</b>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* ── FACTS ────────────────────────────────────────────── */}
          <section className={`${styles.facts} ${styles.reveal}`} data-reveal>
            <div className={styles.fact}>
              <span className={styles.factIcon}>{glyphMail}</span>
              <b className={styles.factTitle}>Direct line</b>
              <p className={styles.factBody}>
                One address, the whole team:{' '}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              </p>
            </div>
            <div className={styles.fact}>
              <span className={styles.factIcon}>{glyphClock}</span>
              <b className={styles.factTitle}>A day to reply</b>
              <p className={styles.factBody}>Within 24–48 hours on weekdays — usually sooner.</p>
            </div>
            <div className={styles.fact}>
              <span className={styles.factIcon}>{glyphShield}</span>
              <b className={styles.factTitle}>Private by default</b>
              <p className={styles.factBody}>
                Straight to the team inbox. No trackers, no mailing lists, nothing stored.
              </p>
            </div>
          </section>

        </div>
      </main>

      <HomeFooter />
    </div>
  )
}
