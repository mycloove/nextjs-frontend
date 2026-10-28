'use client'

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { BanglishSource } from './banglishEditing'
import { isBengaliSpelling } from './banglishLearn'
import { Glyph } from './MrResumeStudioControls'
import styles from './MrResumeStudio.module.css'

export function BanglishWords({ value, offset = 0, sources, onCorrect, t }: {
  value: string
  offset?: number
  sources: readonly BanglishSource[]
  onCorrect: (source: BanglishSource, trigger: HTMLButtonElement) => void
  t: (value: string) => string
}) {
  const parts: ReactNode[] = []
  let cursor = 0
  for (const source of sources) {
    const start = source.start - offset
    const end = source.end - offset
    if (start < cursor || end > value.length || value.slice(start, end) !== source.reading) continue
    if (start > cursor) parts.push(value.slice(cursor, start))
    parts.push(<button key={`${source.start}:${source.end}`} type="button" className={styles.correctableWord} data-banglish-word="true" data-banglish-start={source.start} title={`${t('Correct this word')}: ${source.source}`} aria-label={`${t('Correct this word')}: ${source.reading}`} onClick={(event) => {
      event.stopPropagation()
      onCorrect(source, event.currentTarget)
    }}>{source.reading}</button>)
    cursor = end
  }
  if (cursor < value.length) parts.push(value.slice(cursor))
  return parts
}

export default function BanglishCorrection({ source, candidates, anchor, onConfirm, onDismiss, t }: {
  source: BanglishSource
  candidates: string[]
  anchor: { left: number; top: number; bottom: number }
  onConfirm: (reading: string, remember: boolean) => void
  onDismiss: () => void
  t: (value: string) => string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(source.reading)
  const [remember, setRemember] = useState(true)
  const [position, setPosition] = useState<CSSProperties>({ left: 12, top: 12 })
  const id = `banglish-correction-${useId()}`
  const isWord = isBengaliSpelling(reading.trim())
  const dismissRef = useRef(onDismiss)
  useEffect(() => { dismissRef.current = onDismiss }, [onDismiss])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    const bounds = dialog.getBoundingClientRect()
    setPosition({
      left: Math.max(12, Math.min(anchor.left, window.innerWidth - bounds.width - 12)),
      top: Math.max(12, anchor.bottom + bounds.height + 20 <= window.innerHeight ? anchor.bottom + 8 : Math.min(anchor.top - bounds.height - 8, window.innerHeight - bounds.height - 12)),
    })
    inputRef.current?.focus({ preventScroll: true })
    const dismissOnResize = () => dismissRef.current()
    window.addEventListener('resize', dismissOnResize)
    return () => window.removeEventListener('resize', dismissOnResize)
  }, [anchor])

  return <dialog ref={dialogRef} className={styles.wordCorrection} style={position} aria-labelledby={`${id}-title`} aria-describedby={`${id}-privacy`} onCancel={(event) => { event.preventDefault(); onDismiss() }} onClick={(event) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) onDismiss()
  }}>
    <div className={styles.wordCorrectionHeading}><div><h2 id={`${id}-title`}>{t('Correct this word')}</h2><code>{source.source}</code></div><button type="button" className={styles.iconButton} aria-label={t('Close word correction')} onClick={onDismiss}><Glyph name="close" /></button></div>
    <div className={styles.wordCorrectionOptions} role="group" aria-label={t('Bangla suggestions')}>{candidates.map((option) => <button type="button" key={option} lang="bn" aria-pressed={reading === option} className={`${styles.typeSuggestButton} ${reading === option ? styles.typeSuggestSelected : ''}`} onClick={() => setReading(option)}>{option}</button>)}</div>
    <form onSubmit={(event) => { event.preventDefault(); if (isWord) onConfirm(reading.trim(), remember) }}>
      <label className={styles.contentLabel} htmlFor={`${id}-reading`}>{t('Your spelling')}</label>
      <input ref={inputRef} id={`${id}-reading`} className={styles.textInput} lang="bn" value={reading} maxLength={80} spellCheck={false} onChange={(event) => setReading(event.target.value)} aria-invalid={!isWord} aria-describedby={!isWord ? `${id}-validation` : undefined} />
      {!isWord && <p id={`${id}-validation`} className={styles.correctionError}>{t('Enter one Bengali word, up to 80 characters.')}</p>}
      <label className={styles.rememberCorrection}><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>{t('Remember this spelling on this device')}</span></label>
      <p id={`${id}-privacy`} className={styles.helperText}>{t('Corrections stay on this device and may include personal names. You can clear them in the typing guide.')}</p>
      <div className={styles.wordCorrectionActions}><button type="button" className={styles.bijoyKeep} onClick={() => onConfirm(source.source, false)}>{t('Keep Latin')}</button><button type="submit" className={styles.bijoyConvert} disabled={!isWord}>{t('Apply spelling')}</button></div>
    </form>
  </dialog>
}
