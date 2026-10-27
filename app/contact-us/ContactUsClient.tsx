'use client'

/*
  Contact / The open line

  Motive: turn a stuck workflow, a useful observation, or an idea into a note
  the team can act on. Material: the visitor's own words, not a support console.
  Editorial minimalism carries the page; the composer is the letter itself.
  The category's map, three contact cards, fake availability clock, and ticket
  dashboard add nothing to that task. The form comes first, with an optional
  draft preview instead of a second, competing workspace. A recipient line and
  quiet correspondence marks carry the identity without simulating an inbox.

  Guides change suggestions only. They never overwrite a message or add fields
  to the EmailJS contract. Validation, pending, accepted, and failed are distinct;
  an accepted send is not a human read receipt or a promise of a reply time.
  Failed sends keep the draft. Only a resolved EmailJS send resets the form.

  Ownership: this route's component, CSS Module, and font variables. No shared
  chrome, theme keys, API, credentials, destination, or tool behavior is changed.
*/

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import Link from 'next/link'
import emailjs from '@emailjs/browser'

import HomeFooter from '@/components/HomeFooter'
import Topbar2 from '@/components/Topbar2'

import styles from './ContactUs.module.css'
import '../home.css'

const MESSAGE_LIMIT = 1000
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SERVICE_ID = process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID ?? ''
const TEMPLATE_ID = process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID ?? ''
const PUBLIC_KEY = process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY ?? ''
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'mycloove26@gmail.com'
const emailJsReady = Boolean(SERVICE_ID && TEMPLATE_ID && PUBLIC_KEY)

type FieldKey = 'name' | 'email' | 'message' | 'terms'
type GuideId = 'question' | 'idea' | 'collaboration' | 'note'
type SubmitStatus = { type: 'success' | 'error'; title: string; message: string } | null

const guides: {
  id: GuideId
  label: string
  title: string
  hint: string
  subject: string
  placeholder: string
}[] = [
  { id: 'question', label: 'A tool question', title: 'A little context helps.', hint: 'Which tool? Which file type? What did you expect, and what happened instead? A short description is enough to begin.', subject: 'For example, a question about PDF to Word', placeholder: 'I was using [tool] with a [file type]. I expected... What happened was...' },
  { id: 'idea', label: 'An idea', title: 'Tell us about the work.', hint: 'What are you trying to do? What gets in the way? The workflow behind an idea helps us understand what would make a difference.', subject: 'For example, a tool you wish existed', placeholder: 'It would make my work easier if I could...' },
  { id: 'collaboration', label: 'A collaboration', title: 'Give us the bigger picture.', hint: 'Tell us about your project, who it serves, and how you imagine working with mycloove. A little context is a good introduction.', subject: 'For example, a project or API enquiry', placeholder: 'Here is a little about our project, and where mycloove might fit...' },
  { id: 'note', label: 'Just a note', title: 'Start wherever you like.', hint: 'A small observation, some feedback, or a simple hello. You do not need a polished pitch to start a useful conversation.', subject: 'A short subject, if you would like one', placeholder: 'Here is what is on my mind...' },
]

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {diagonal ? <path d="M6 18 18 6M6 6h12v12" /> : <path d="M4 12h16m-6-6 6 6-6 6" />}
    </svg>
  )
}

function StatusMark({ success }: { success: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      {success ? <path d="m8 12 3 3 5-6" /> : <path d="M12 7v6m0 4h.01" />}
    </svg>
  )
}

export default function ContactUsClient({ fontClass = '' }: { fontClass?: string }) {
  const formRef = useRef<HTMLFormElement>(null)
  const feedbackRef = useRef<HTMLDivElement>(null)
  const sendingRef = useRef(false)
  const [formData, setFormData] = useState({ name: '', email: '', subject: '', message: '' })
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [guideId, setGuideId] = useState<GuideId>('note')
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>(null)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const guide = guides.find((item) => item.id === guideId)!

  const errors: Record<FieldKey, string> = {
    name: formData.name.trim() ? '' : 'Please add your name.',
    email: emailRe.test(formData.email.trim()) ? '' : 'Enter an email address we can reply to.',
    message: !formData.message.trim() ? 'Please write a little about what is on your mind.' : formData.message.length > MESSAGE_LIMIT ? `Keep your note within ${MESSAGE_LIMIT} characters.` : '',
    terms: acceptTerms ? '' : 'Please accept the terms and privacy policy before sending.',
  }
  const allReady = Object.values(errors).every((error) => !error)
  const sent = submitStatus?.type === 'success'
  const draftState = isSubmitting ? 'Sending' : sent ? 'Accepted' : allReady && emailJsReady ? 'Ready to send' : 'Not sent'

  useEffect(() => {
    // Validation focuses the first missing field; transport feedback gets its
    // own focus target after rendering, without moving the visitor's scroll.
    if (submitStatus && (submitStatus.type === 'success' || allReady)) {
      feedbackRef.current?.focus({ preventScroll: true })
    }
  }, [submitStatus, allReady])

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target
    setFormData((previous) => ({ ...previous, [name]: value }))
    setSubmitStatus(null)
  }

  const markTouched = (field: FieldKey) => setTouched((previous) => ({ ...previous, [field]: true }))

  const copyEmail = async () => {
    setCopyStatus('copying')
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(CONTACT_EMAIL)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('error')
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sendingRef.current) return

    const invalid = (Object.keys(errors) as FieldKey[]).find((field) => errors[field])
    if (invalid) {
      setTouched({ name: true, email: true, message: true, terms: true })
      setSubmitStatus({ type: 'error', title: 'A little more information, please.', message: 'Check the highlighted fields. Your draft has not been sent.' })
      formRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${invalid}"]`)?.focus()
      return
    }
    if (!emailJsReady) {
      setSubmitStatus({ type: 'error', title: 'The web form is unavailable.', message: `Your draft has not been sent. Please write directly to ${CONTACT_EMAIL}.` })
      return
    }

    sendingRef.current = true
    setIsSubmitting(true)
    setSubmitStatus(null)
    try {
      // Keep the established template parameters and optional-subject fallback.
      await emailjs.send(SERVICE_ID, TEMPLATE_ID, {
        from_name: formData.name,
        from_email: formData.email,
        subject: formData.subject || 'No Subject',
        message: formData.message,
        to_email: CONTACT_EMAIL,
      }, PUBLIC_KEY)
      setSubmitStatus({ type: 'success', title: 'Thank you for the note.', message: 'Our email service accepted your message. This confirms submission, not that it has been read.' })
      setFormData({ name: '', email: '', subject: '', message: '' })
      setAcceptTerms(false)
      setTouched({})
      formRef.current?.reset()
    } catch {
      setSubmitStatus({ type: 'error', title: 'That send did not go through.', message: `Your words are still here. Try again, or email ${CONTACT_EMAIL} directly.` })
    } finally {
      sendingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div className="home-page">
      <Topbar2 openFileHref="/#heroFile" />

      {/* The root layout owns the main landmark; this is the skip-link target. */}
      <div id="main-content" className={`${styles.page} ${fontClass}`} tabIndex={-1}>
        <div className={styles.shell}>
          <div className={styles.masthead}>
            <p>Contact us <span lang="bn">/ যোগাযোগ</span></p>
            <span>Good conversations make better tools.</span>
          </div>

          <div className={styles.contactLayout}>
            <section className={styles.introduction} aria-labelledby="contact-title">
              <p className={styles.eyebrow}><span aria-hidden="true" />An open line to mycloove</p>
              <h1 id="contact-title" className={styles.title}>A small note.<br />A big <span>difference.</span></h1>
              <p className={styles.lede}>The best part of building tools is hearing from the people who use them.</p>
              <p className={styles.introNote}>A stuck file, a useful idea, or something we could do better. There&apos;s room for all of it here.</p>
              <a href="#contact-composer" className={styles.startLink}>Start a conversation <Arrow /></a>

              <div className={styles.correspondenceMark} aria-hidden="true">
                <svg width="104" height="72" viewBox="0 0 104 72" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
                  <path className={styles.markBack} d="M12 22h62v40H12z" />
                  <path d="M30 10h62v42H30zM30 11l31 23 31-23M30 52l22-24m40 24L70 28" />
                  <path d="M4 34h18M4 42h12" />
                </svg>
                <p>Your words.<br /><span>A better way forward.</span></p>
              </div>
              <p className={styles.banglaIntro} lang="bn">আপনার কথাই পরের পরিবর্তনের শুরু।</p>

              <div className={styles.introFootnote}>
                <span className={styles.footnoteLine} aria-hidden="true" />
                <p>No account needed.<br /> English or <span lang="bn">বাংলা</span>. Write in your own words.</p>
              </div>
            </section>

            <section id="contact-composer" className={styles.composer} aria-labelledby="composer-title">
              <div className={styles.letterhead}>
                <div><span className={styles.sectionLabel}>A direct line</span><span className={styles.recipient}>To the mycloove team <Arrow diagonal /></span></div>
                <span className={styles.draftState} data-state={isSubmitting ? 'sending' : sent ? 'sent' : 'draft'} role="status"><i aria-hidden="true" />{draftState}</span>
              </div>

              <div className={styles.composerBody}>
                <div className={styles.composerHeading}>
                  <h2 id="composer-title">What&apos;s on your mind?</h2>
                  <p>A few words are a good place to start.</p>
                </div>

                {!emailJsReady && <div id="contact-delivery-note" className={styles.transportNotice}><StatusMark success={false} /><p>The web form is unavailable right now. You can still prepare a draft, or <a href={`mailto:${CONTACT_EMAIL}`}>email us directly</a> to send your note.</p></div>}
                <noscript><p className={styles.transportNotice}>This form needs JavaScript to send. You can <a href={`mailto:${CONTACT_EMAIL}`}>email us directly</a> instead.</p></noscript>

                <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
                  <fieldset className={styles.formFields} disabled={isSubmitting}>
                    <legend className={styles.srOnly}>Your contact information and message. Name, email, message, and consent are required.</legend>
                    <div className={styles.formRow}>
                      <div className={styles.field}>
                        <label htmlFor="contact-name">Your name <span aria-hidden="true">*</span></label>
                        <input id="contact-name" name="name" type="text" value={formData.name} onChange={handleChange} onBlur={() => markTouched('name')} required autoComplete="name" placeholder="How should we address you?" aria-invalid={touched.name && !!errors.name} aria-describedby={touched.name && errors.name ? 'contact-name-error' : undefined} />
                        {touched.name && errors.name && <p id="contact-name-error" className={styles.fieldError}>{errors.name}</p>}
                      </div>
                      <div className={styles.field}>
                        <label htmlFor="contact-email">Email address <span aria-hidden="true">*</span></label>
                        <input id="contact-email" name="email" type="email" value={formData.email} onChange={handleChange} onBlur={() => markTouched('email')} required autoComplete="email" placeholder="you@example.com" aria-invalid={touched.email && !!errors.email} aria-describedby={touched.email && errors.email ? 'contact-email-error' : undefined} />
                        {touched.email && errors.email && <p id="contact-email-error" className={styles.fieldError}>{errors.email}</p>}
                      </div>
                    </div>
                    <fieldset className={styles.guidePicker} aria-describedby="contact-guide-help">
                      <legend>What brings you here? <span>Optional</span></legend>
                      <div className={styles.guideOptions}>
                        {guides.map((item) => (
                          <label key={item.id} className={styles.guideOption}>
                            <input type="radio" name="writing-guide" value={item.id} checked={guideId === item.id} onChange={() => setGuideId(item.id)} />
                            <span className={styles.guideChoice}><span className={styles.radioMark} aria-hidden="true" />{item.label}</span>
                          </label>
                        ))}
                      </div>
                      <p id="contact-guide-help" className={styles.guideHelp}>Optional guidance. Switching won&apos;t change your words.</p>
                    </fieldset>
                    <div className={styles.field}>
                      <label htmlFor="contact-subject">Subject <span className={styles.optional}>Optional</span></label>
                      <input id="contact-subject" name="subject" type="text" value={formData.subject} onChange={handleChange} placeholder={guide.subject} />
                    </div>
                    <div className={`${styles.field} ${styles.messageField}`}>
                      <label htmlFor="contact-message">Your message <span aria-hidden="true">*</span></label>
                      <textarea id="contact-message" name="message" rows={6} value={formData.message} onChange={handleChange} onBlur={() => markTouched('message')} required maxLength={MESSAGE_LIMIT} placeholder={guide.placeholder} aria-invalid={touched.message && !!errors.message} aria-describedby={`contact-message-help contact-charcount${touched.message && errors.message ? ' contact-message-error' : ''}`} />
                      <div className={styles.messageMeta}><span id="contact-message-help">Please leave private document contents out.</span><span id="contact-charcount" className={styles.charcount}>{formData.message.length} / {MESSAGE_LIMIT}</span></div>
                      {touched.message && errors.message && <p id="contact-message-error" className={styles.fieldError}>{errors.message}</p>}
                    </div>

                    <label className={styles.terms}>
                      <input name="terms" type="checkbox" checked={acceptTerms} onChange={(event) => { setAcceptTerms(event.target.checked); setSubmitStatus(null) }} onBlur={() => markTouched('terms')} required aria-invalid={touched.terms && !!errors.terms} aria-describedby={touched.terms && errors.terms ? 'contact-terms-error' : undefined} />
                      <span>I accept the <Link href="/terms" onClick={(event) => event.stopPropagation()}>Terms &amp; Conditions</Link> and the <Link href="/privacy" onClick={(event) => event.stopPropagation()}>Privacy Policy</Link>.</span>
                    </label>
                    {touched.terms && errors.terms && <p id="contact-terms-error" className={styles.fieldError}>{errors.terms}</p>}
                  </fieldset>

                  {submitStatus && (
                    <div ref={feedbackRef} tabIndex={-1} className={`${styles.feedback} ${submitStatus.type === 'success' ? styles.feedbackSuccess : styles.feedbackError}`} role={submitStatus.type === 'success' ? 'status' : 'alert'}>
                      <StatusMark success={submitStatus.type === 'success'} /><div><h3>{submitStatus.title}</h3><p>{submitStatus.message}</p>{submitStatus.type === 'error' && <a href={`mailto:${CONTACT_EMAIL}`}>Use direct email<Arrow diagonal /></a>}</div>
                    </div>
                  )}

                  <div className={styles.sendRow}>
                    <button type="submit" className={styles.sendButton} disabled={isSubmitting || !emailJsReady} aria-describedby={!emailJsReady ? 'contact-delivery-note' : undefined}>
                      {isSubmitting ? <><span className={styles.spinner} aria-hidden="true" />Sending your note...</> : !emailJsReady ? 'Web form unavailable' : <>Send message<Arrow /></>}
                    </button>
                    {!emailJsReady ? <a className={styles.fallbackLink} href={`mailto:${CONTACT_EMAIL}`}>Use direct email <Arrow diagonal /></a> : <p role="status">{isSubmitting ? 'Waiting for the email service to confirm.' : 'A note, not a live chat.'}<br />{isSubmitting ? 'Your draft stays until the send is accepted.' : 'No need to get every word perfect.'}</p>}
                  </div>
                </form>

                <details className={styles.preview}>
                  <summary><span>{sent ? 'View submission confirmation' : 'Preview your note'}</span><span className={styles.disclosure} aria-hidden="true" /></summary>
                  <div className={styles.letter} data-state={sent ? 'sent' : 'draft'}>
                    <div className={styles.letterRouting}>
                      <div><span className={styles.letterLabel}>To</span><strong>mycloove</strong><span className={styles.letterEmail}>{CONTACT_EMAIL}</span></div>
                      <span className={styles.letterTag}>{sent ? 'ACCEPTED' : 'DRAFT'}</span>
                    </div>
                    {sent ? (
                      <div className={styles.receipt}>
                        <StatusMark success /><h3>Thank you for writing.</h3><p>Our email service accepted your message. This confirms submission, not that it has been read.</p><button type="button" onClick={() => { setSubmitStatus(null); formRef.current?.querySelector<HTMLInputElement>('[name="name"]')?.focus() }}>Write another note<Arrow /></button>
                      </div>
                    ) : (
                      <>
                        <div className={styles.letterFrom}><span className={styles.letterLabel}>From</span><strong className={!formData.name.trim() ? styles.placeholderText : undefined}>{formData.name.trim() || 'Your name'}</strong><span className={!formData.email.trim() ? styles.placeholderText : undefined}>{formData.email.trim() || 'Your email address'}</span></div>
                        <div className={styles.letterContent}><span className={styles.letterSubject}>{formData.subject.trim() || 'No subject added'}</span><p tabIndex={formData.message.trim() ? 0 : undefined} aria-label={formData.message.trim() ? 'Message draft preview' : undefined} className={!formData.message.trim() ? styles.placeholderText : undefined}>{formData.message.trim() ? formData.message : 'The words you write will appear here.\n\nNo perfect pitch required.'}</p></div>
                        <p className={styles.letterFooter}>{isSubmitting ? 'Sending. Awaiting confirmation.' : 'A draft, not a delivered message.'}</p>
                      </>
                    )}
                  </div>
                </details>
              </div>
            </section>

            <aside className={styles.directLine} aria-labelledby="direct-title">
              <p className={styles.sectionLabel}>Your inbox works, too</p>
              <h2 id="direct-title">Prefer a direct hello?</h2>
              <a href={`mailto:${CONTACT_EMAIL}`} className={styles.emailAddress}><span>{CONTACT_EMAIL}</span><Arrow diagonal /></a>
              <div className={styles.copyRow}>
                <button type="button" className={styles.copyButton} onClick={copyEmail} disabled={copyStatus === 'copying'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H4v13h4" /></svg>
                  {copyStatus === 'copying' ? 'Copying...' : copyStatus === 'copied' ? 'Address copied' : 'Copy email address'}
                </button>
                <span className={styles.copyFeedback} role="status">{copyStatus === 'copied' ? 'Copied to your clipboard.' : copyStatus === 'error' ? 'Could not copy. Use the email link or select the address.' : ''}</span>
              </div>
              <p className={styles.directNote}>Opens your mail app. Send when you&apos;re ready.</p>
              <div className={styles.writingGuide} key={guideId} aria-live="polite" aria-atomic="true"><span className={styles.guideLabel}>A thought to get you started</span><h3>{guide.title}</h3><p>{guide.hint}</p></div>
            </aside>
          </div>

          <section className={styles.detailsSection} aria-labelledby="details-title">
            <div><span className={styles.sectionLabel}>A little clarity</span><h2 id="details-title">Before you<br /> press send.</h2><p>Simple answers, so you know what to expect.</p><Link href="/faq" className={styles.helpLink}>More questions? Visit the FAQ <Arrow diagonal /></Link></div>
            <div className={styles.answers}>
              <details><summary><h3>Can I attach a document?</h3><span className={styles.disclosure} aria-hidden="true" /></summary><p>This form is text-only. Start with the tool name, file type, and a short description of what happened. Please do not paste confidential document contents into your note.</p></details>
              <details><summary><h3>When will I hear back?</h3><span className={styles.disclosure} aria-hidden="true" /></summary><p>You can write whenever it suits you. This is not live chat, and we cannot promise an exact reply time. Include an email address where you can receive a response.</p></details>
              <details><summary><h3>How is my message handled?</h3><span className={styles.disclosure} aria-hidden="true" /></summary><p>The web form sends your name, email, subject, and message through our email service. Direct email uses your own mail app. Our <Link href="/privacy">privacy policy</Link> explains how contact information is handled.</p></details>
            </div>
          </section>

          <div className={styles.signoff}><p>Better tools begin with the work you do.</p><Link href="/about-us">Meet mycloove<Arrow diagonal /></Link></div>
        </div>
      </div>

      <HomeFooter />
    </div>
  )
}
