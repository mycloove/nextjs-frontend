'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { resumeTemplates, templateSectionTitle, type ResumeTemplate } from './resumeTemplates'
import { bengaliTypefaces, latinTypefaces } from './resumeFonts'
import { Glyph } from './MrResumeStudioControls'
import styles from './MrResumeStudio.module.css'

// The preview specimen loads the template's own face — Latin Modern included —
// so "Recommended typeface" is literally what the dialog shows.
const previewFontFamilies = new Map<string, string>([...bengaliTypefaces, ...latinTypefaces].map((font) => [font.name as string, font.family]))

export default function ResumeTemplateLibrary({ selected, hasBackup, onApply, onRestore, onExportBackup, sectionTitle, catalogTitle, t }: {
  selected: string | null
  hasBackup: boolean
  onApply: (template: ResumeTemplate) => void
  onRestore: () => void
  onExportBackup: () => void
  sectionTitle: (section: string) => string
  catalogTitle: (section: string) => string
  t: (value: string) => string
}) {
  const [preview, setPreview] = useState<ResumeTemplate | null>(null)
  const [replaceBackup, setReplaceBackup] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const id = `resume-template-${useId()}`

  useEffect(() => {
    if (preview && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal()
  }, [preview])

  // The preview specimen loads the template's own face — Latin Modern included —
  // so "Recommended typeface" is literally what the dialog shows.
  function dismiss() {
    setPreview(null)
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }))
  }

  return <div className={styles.templateLibrary}>
    <details>
      <summary><Glyph name="page" /><span>{t('Templates')}</span><small>{resumeTemplates.length}</small></summary>
      <p className={styles.helperText}>{t('Start with a purposeful outline. Preview first; your current draft gets a restore copy.')}</p>
      <div className={styles.templateList} role="group" aria-label={t('Templates')}>
        {resumeTemplates.map((template) => <button type="button" key={template.id} className={styles.templateChoice} aria-pressed={selected === template.id} aria-haspopup="dialog" onClick={(event) => { triggerRef.current = event.currentTarget; setPreview(template); setReplaceBackup(false) }}><span><b>{t(template.name)}</b><small>{t(template.detail)}</small></span>{selected === template.id ? <Glyph name="check" /> : <Glyph name="chevron" />}</button>)}
      </div>
    </details>
    {hasBackup && <div className={styles.templateRestore}><button type="button" className={styles.guideLink} onClick={onRestore}><Glyph name="undo" />{t('Restore previous draft')}</button><button type="button" className={styles.guideLink} onClick={onExportBackup}>{t('Download restore copy')}</button></div>}
    {preview && <dialog ref={dialogRef} className={styles.templateDialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-policy`} onCancel={(event) => { event.preventDefault(); dismiss() }}>
      <div className={styles.wordCorrectionHeading}><div><span className={styles.eyebrow}>{t('TEMPLATE PREVIEW')}</span><h2 id={`${id}-title`}>{t(preview.name)}</h2></div><button type="button" className={styles.iconButton} aria-label={t('Close template preview')} onClick={dismiss}><Glyph name="close" /></button></div>
      <p id={`${id}-policy`} className={styles.templatePolicy}>{t('Bracketed text is a writing prompt, not a claim about you. Replace it with verified details. Applying creates a restore copy before changing this draft.')}</p>
      <div className={styles.templatePreview} lang={preview.language === 'English' ? 'en' : 'bn'} data-font={preview.font} style={{ fontFamily: previewFontFamilies.get(preview.font) ?? '"Noto Sans Bengali", sans-serif' }}><h3>{preview.fullName}</h3>{preview.enabled.map((section) => <div key={section}>{section !== 'profile' && <h4>{templateSectionTitle(preview, section, { english: catalogTitle, bangla: sectionTitle })}</h4>}<p>{preview.content[section]}</p></div>)}</div>
      <p className={styles.helperText}>{t('Recommended typeface')}: {preview.font}. {t('Writing prompts, not the final page layout.')}</p>
      {hasBackup && <div className={styles.templateBackupWarning}><p>{t('A restore copy already exists. Applying another template replaces it. Download that copy first if you want to keep it.')}</p><button type="button" className={styles.guideLink} onClick={onExportBackup}>{t('Download restore copy')}</button><label className={styles.rememberCorrection}><input type="checkbox" checked={replaceBackup} onChange={(event) => setReplaceBackup(event.target.checked)} /><span>{t('Replace the old restore copy with my current draft')}</span></label></div>}
      <div className={styles.wordCorrectionActions}><button type="button" className={styles.bijoyKeep} onClick={dismiss}>{t('Keep current draft')}</button><button type="button" className={styles.bijoyConvert} disabled={hasBackup && !replaceBackup} onClick={() => { onApply(preview); setPreview(null) }}>{t('Apply with restore copy')}</button></div>
    </dialog>}
  </div>
}
