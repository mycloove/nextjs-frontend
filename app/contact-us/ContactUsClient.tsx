'use client'

/*
  Contact / The correspondence desk

  Motive: turn a stuck workflow, a useful observation, or an idea into a note
  the team can act on. Material: the visitor's own words, not a support console.
  Editorial minimalism carries the page; a live letter is its tactile accent.
  The category's map, three contact cards, fake availability clock, and ticket
  dashboard add nothing to that task. The draft, not ornament, is the signature.

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

      <main id="main-content" className={`${styles.page} ${fontClass}`}>
        <div className={styles.shell}>
          <div className={styles.masthead}><p>Correspondence <span lang="bn">/ যোগাযোগ</span></p><span>A note, not a ticket.</span></div>

          <section className={styles.hero} aria-labelledby="contact-title">
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}><span />The mycloove correspondence desk</p>
              <h1 id="contact-title" className={styles.title}>A stuck file.<br />A new idea.<br /><span>Let&apos;s talk.</span></h1>
              <p className={styles.lede}>A question about a tool. An idea worth building. A detail we could do better. Write to the people building mycloove.</p>
              <p className={styles.banglaIntro} lang="bn">আপনার কথাই পরের পরিবর্তনের শুরু।</p>
            </div>

            <aside className={styles.directLine} aria-labelledby="direct-title">
              <span className={styles.sectionLabel}>Same desk. Your own inbox.</span>
              <h2 id="direct-title">Prefer to email?</h2>
              <a href={`mailto:${CONTACT_EMAIL}`} className={styles.emailAddress}>{CONTACT_EMAIL}<Arrow diagonal /></a>
              <div className={styles.copyRow}>
                <button type="button" className={styles.copyButton} onClick={copyEmail} disabled={copyStatus === 'copying'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H4v13h4" /></svg>
                  {copyStatus === 'copying' ? 'Copying...' : copyStatus === 'copied' ? 'Address copied' : 'Copy address'}
                </button>
                <span className={styles.copyFeedback} role="status">{copyStatus === 'copied' ? 'Copied to your clipboard.' : copyStatus === 'error' ? 'Could not copy. Use the email link or select the address.' : ''}</span>
              </div>
              <p className={styles.directNote}>The link opens your mail app.<br />No account needed to write to us.</p>
            </aside>
          </section>

          <section className={styles.desk} aria-labelledby="composer-title">
            <div className={styles.deskHeading}><span className={styles.sectionLabel}>A little space for your words</span><span className={styles.deskCaption}>English or <span lang="bn">বাংলা</span>. Both belong here.</span></div>

            <fieldset className={styles.guidePicker} disabled={isSubmitting}>
              <legend>Choose a starting point<span>Optional. It changes the guide, not your words.</span></legend>
              <div className={styles.guideOptions}>
                {guides.map((item) => (
                  <label key={item.id} className={styles.guideOption}>
                    <input type="radio" name="writing-guide" value={item.id} checked={guideId === item.id} onChange={() => setGuideId(item.id)} />
                    <span className={styles.guideChoice}><span className={styles.radioMark} aria-hidden="true" /><span>{item.label}</span><Arrow diagonal /></span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className={styles.deskGrid}>
              <div className={styles.composer}>
                <div className={styles.composerHeading}><h2 id="composer-title">Leave us a note.</h2><span>Required fields <span aria-hidden="true">*</span></span></div>
                {!emailJsReady && <div className={styles.transportNotice}><StatusMark success={false} /><p>The web form is not configured right now. Your draft preview still works. Please <a href={`mailto:${CONTACT_EMAIL}`}>email us directly</a> to send your note.</p></div>}

                <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
                  <fieldset className={styles.formFields} disabled={isSubmitting}>
                    <legend className={styles.srOnly}>Your contact information and message</legend>
                    <div className={styles.formRow}>
                      <div className={styles.field}>
                        <label htmlFor="contact-name">Your name <span aria-hidden="true">*</span></label>
                        <input id="contact-name" name="name" type="text" value={formData.name} onChange={handleChange} onBlur={() => markTouched('name')} required autoComplete="name" placeholder="How should we address you?" aria-invalid={touched.name && !!errors.name} aria-describedby={touched.name && errors.name ? 'contact-name-error' : undefined} />
                        {touched.name && errors.name && <p id="contact-name-error" className={styles.fieldError}>{errors.name}</p>}
                      </div>
                      <div className={styles.field}>
                        <label htmlFor="contact-email">Your email <span aria-hidden="true">*</span></label>
                        <input id="contact-email" name="email" type="email" value={formData.email} onChange={handleChange} onBlur={() => markTouched('email')} required autoComplete="email" placeholder="Where we can reply" aria-invalid={touched.email && !!errors.email} aria-describedby={touched.email && errors.email ? 'contact-email-error' : undefined} />
                        {touched.email && errors.email && <p id="contact-email-error" className={styles.fieldError}>{errors.email}</p>}
                      </div>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="contact-subject">Subject <span className={styles.optional}>Optional</span></label>
                      <input id="contact-subject" name="subject" type="text" value={formData.subject} onChange={handleChange} placeholder={guide.subject} />
                    </div>
                    <div className={`${styles.field} ${styles.messageField}`}>
                      <label htmlFor="contact-message">Your message <span aria-hidden="true">*</span></label>
                      <textarea id="contact-message" name="message" rows={6} value={formData.message} onChange={handleChange} onBlur={() => markTouched('message')} required maxLength={MESSAGE_LIMIT} placeholder={guide.placeholder} aria-invalid={touched.message && !!errors.message} aria-describedby={`contact-message-help contact-charcount${touched.message && errors.message ? ' contact-message-error' : ''}`} />
                      <div className={styles.messageMeta}><span id="contact-message-help">A description is enough. Please leave private file contents out.</span><span id="contact-charcount" className={styles.charcount}>{formData.message.length} / {MESSAGE_LIMIT}</span></div>
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
                    <button type="submit" className={styles.sendButton} disabled={isSubmitting}>
                      {isSubmitting ? <><span className={styles.spinner} aria-hidden="true" />Sending your note...</> : <>Send message<Arrow /></>}
                    </button>
                    <p role="status">{isSubmitting ? 'Waiting for the email service to confirm.' : 'Uses our email service.'}<br />{isSubmitting ? 'Your draft is kept until it accepts the send.' : 'Not a live chat. No rush to get the words right.'}</p>
                  </div>
                </form>
              </div>

              <aside className={styles.deskAside} aria-label="Your draft and writing guide">
                <div className={styles.previewHeading}><span className={styles.sectionLabel}>Your note, as you write</span><span className={styles.draftState} data-state={isSubmitting ? 'sending' : sent ? 'sent' : 'draft'}><i aria-hidden="true" />{draftState}</span></div>
                <div className={styles.letter} data-state={sent ? 'sent' : 'draft'}>
                  <div className={styles.letterRouting}><div><span className={styles.letterLabel}>To</span><strong>mycloove</strong><span className={styles.letterEmail}>{CONTACT_EMAIL}</span></div><div className={styles.postage} aria-hidden="true"><svg width="32" height="28" viewBox="0 0 40 32" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="3" y="5" width="34" height="23" rx="1" /><path d="m3 6 17 12L37 6M3 28l12-11m22 11L25 17" /></svg><span>{sent ? 'ACCEPTED' : 'DRAFT'}</span></div></div>
                  {sent ? (
                    <div className={styles.receipt}>
                      <span className={styles.receiptMark}><StatusMark success /></span><h3>A note, on its way.</h3><p>Our email service accepted your message. Thank you for taking the time to write.</p><span className={styles.receiptNote}>Submission confirmed. Not a read receipt.</span><button type="button" onClick={() => { setSubmitStatus(null); formRef.current?.querySelector<HTMLInputElement>('[name="name"]')?.focus() }}>Write another note<Arrow /></button>
                    </div>
                  ) : (
                    <>
                      <div className={styles.letterFrom}><span className={styles.letterLabel}>From</span><strong className={!formData.name.trim() ? styles.placeholderText : undefined}>{formData.name.trim() || 'Your name'}</strong><span className={!formData.email.trim() ? styles.placeholderText : undefined}>{formData.email.trim() || 'Your email address'}</span></div>
                      <div className={styles.letterContent}><span className={styles.letterSubject}>{formData.subject.trim() || 'No subject added'}</span><p tabIndex={formData.message.trim() ? 0 : undefined} aria-label={formData.message.trim() ? 'Message draft preview' : undefined} className={!formData.message.trim() ? styles.placeholderText : undefined}>{formData.message.trim() ? formData.message : 'The words you write will appear here.\n\nNo perfect pitch required.'}</p></div>
                      <div className={styles.letterFooter}><span>{isSubmitting ? 'Sending. Awaiting confirmation.' : 'A draft, not a delivered message.'}</span><span className={styles.clasp} aria-hidden="true"><i /><i /></span></div>
                    </>
                  )}
                </div>
                <div className={styles.writingGuide} key={guideId}><span className={styles.guideLabel}>Writing guide / {guide.label}</span><h3>{guide.title}</h3><p>{guide.hint}</p></div>
              </aside>
            </div>
          </section>

          <section className={styles.detailsSection} aria-labelledby="details-title">
            <div><span className={styles.sectionLabel}>Before you send</span><h2 id="details-title">A little clarity.<br />Less back-and-forth.</h2><p>Just the useful details.<br />No small print disguised as a promise.</p></div>
            <div className={styles.answers}>
              <details><summary><h3>Can I attach a document?</h3><span className={styles.disclosure} aria-hidden="true" /></summary><p>This form is text-only. Start with the tool name, file type, and a short description of what happened. Please do not paste confidential document contents into your note.</p></details>
              <details><summary><h3>When will I hear back?</h3><span className={styles.disclosure} aria-hidden="true" /></summary><p>You can write whenever it suits you. This is not live chat, and we cannot promise an exact reply time. Include an email address where you can receive a response.</p></details>
              <details><summary><h3>How is my message handled?</h3><span className={styles.disclosure} aria-hidden="true" /></summary><p>The web form sends your name, email, subject, and message through our email service. Direct email uses your own mail app. Our <Link href="/privacy">privacy policy</Link> explains how contact information is handled.</p></details>
            </div>
          </section>

          <div className={styles.signoff}><p>Better tools begin with the work you do.</p><Link href="/about-us">Meet mycloove<Arrow diagonal /></Link></div>
        </div>
      </main>

      <HomeFooter />
    </div>
  )
}
