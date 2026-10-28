'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { suggestBilingualText } from './resumeBilingual'
import type { BanglishSource } from './banglishEditing'
import { Glyph } from './MrResumeStudioControls'
import styles from './MrResumeStudio.module.css'

export type LanguageProposal = {
  section: string
  sourceTitle: string
  sourceContent: string
  sourceLanguage: 'English' | 'Bangla'
  title: string
  content: string
  target: 'English' | 'Bangla'
  switchDocumentLanguage: boolean
}

export default function ResumeLanguageSuggestions({ section, title, content, language, targetTitle, sources, onApply, t }: {
  section: string
  title: string
  content: string
  language: 'English' | 'Bangla'
  targetTitle?: string
  sources: { title: readonly BanglishSource[]; content: readonly BanglishSource[] }
  onApply: (proposal: LanguageProposal) => void
  t: (value: string) => string
}) {
  const [stored, setStored] = useState<(LanguageProposal & { replacements: number }) | null>(null)
  const proposal = stored?.section === section && stored.sourceLanguage === language && stored.sourceTitle === title && stored.sourceContent === content ? stored : null
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const id = `resume-language-suggestion-${useId()}`
  const target = language === 'English' ? 'Bangla' : 'English'
  const open = Boolean(proposal)

  useEffect(() => {
    const dialog = dialogRef.current
    if (open && dialog && !dialog.open) {
      dialog.showModal()
      wasOpen.current = true
    } else if (!open && wasOpen.current) {
      wasOpen.current = false
      triggerRef.current?.focus({ preventScroll: true })
    }
  }, [open])

  function suggest() {
    const heading = suggestBilingualText(title, target, { name: section === 'profile', sources: sources.title })
    const body = suggestBilingualText(content, target, { sources: sources.content })
    setStored({ section, sourceTitle: title, sourceContent: content, sourceLanguage: language, title: targetTitle ?? heading.value, content: body.value, target, switchDocumentLanguage: false, replacements: (targetTitle !== undefined ? Number(targetTitle !== title) : heading.replacements) + body.replacements })
  }

  return <section className={styles.languageSuggestions} aria-label={t('Language version suggestions')}>
    <button ref={triggerRef} type="button" className={styles.guideLink} aria-haspopup="dialog" aria-expanded={open} aria-controls={proposal ? id : undefined} onClick={suggest}><Glyph name="globe" />{t(target === 'Bangla' ? 'Suggest Bangla version' : 'Suggest English version')}</button>
    {proposal && <dialog ref={dialogRef} id={id} className={styles.languageReview} aria-labelledby={`${id}-heading`} aria-describedby={`${id}-policy`} onCancel={(event) => { event.preventDefault(); setStored(null) }}>
      <div className={styles.wordCorrectionHeading}><h2 id={`${id}-heading`}>{t('Review language suggestion')}</h2><button type="button" className={styles.iconButton} aria-label={t('Close language suggestion')} onClick={() => setStored(null)}><Glyph name="close" /></button></div>
      <p id={`${id}-policy`} className={styles.suggestionPolicy}>{t('Known names, degrees and headings only. Other writing stays unchanged. This is not a prose translation. Review or edit the suggestion before applying.')}</p>
      <div className={styles.languageReviewColumns}><div><h3>{t('Current writing')}</h3><p className={styles.originalHeading}>{title}</p><p className={styles.originalWriting}>{content}</p></div><div><h3>{t('Suggested writing')} <span>{t(proposal.target)}</span></h3><label htmlFor={`${id}-title`}>{t('Suggested heading or name')}</label><input id={`${id}-title`} className={styles.textInput} lang={proposal.target === 'Bangla' ? 'bn' : 'en'} value={proposal.title} onChange={(event) => setStored({ ...proposal, title: event.target.value })} /><label htmlFor={`${id}-content`}>{t('Suggested content')}</label><textarea id={`${id}-content`} className={styles.contentInput} lang={proposal.target === 'Bangla' ? 'bn' : 'en'} value={proposal.content} rows={6} onChange={(event) => setStored({ ...proposal, content: event.target.value })} /></div></div>
      <p className={styles.helperText}>{proposal.replacements} {t('supported replacements')}. {t('Not applied to your resume.')}</p>
      <label className={styles.rememberCorrection}><input type="checkbox" checked={proposal.switchDocumentLanguage} onChange={(event) => setStored({ ...proposal, switchDocumentLanguage: event.target.checked })} /><span>{t('Also switch the document heading language')}</span></label>
      <div className={styles.wordCorrectionActions}><button type="button" className={styles.bijoyKeep} onClick={() => setStored(null)}>{t('Keep current writing')}</button><button type="button" className={styles.bijoyConvert} disabled={proposal.title === title && proposal.content === content && !proposal.switchDocumentLanguage} onClick={() => { onApply(proposal); setStored(null) }}>{t('Apply to this section')}</button></div>
    </dialog>}
  </section>
}
